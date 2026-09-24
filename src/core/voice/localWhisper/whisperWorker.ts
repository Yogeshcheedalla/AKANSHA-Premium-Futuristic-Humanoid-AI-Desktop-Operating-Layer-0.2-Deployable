/**
 * Offline Whisper via a spawned plain-node worker.
 *
 * The Next.js server bundle cannot host onnxruntime-node's native binding
 * reliably (in-process load throws, so transcription silently fell through to a
 * cloud ASR). But a plain node process (Electron-as-node in the packaged app,
 * system node in dev) loads transformers + the bundled Whisper model and
 * transcribes OFFLINE with no key — verified directly. So we delegate the actual
 * transcription to a short-lived worker process and read back JSON.
 *
 * No cloud, no key, no silent paid fallback. If the worker fails, we throw and
 * the caller decides (it must NOT pretend a transcript exists).
 */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Runs in the worker (plain node). Loads the bundled model with the hub disabled
// and prints {"text": "..."} on stdout. Kept dependency-free (inline WAV decode).
const WORKER = `
const fs=require('fs');
function dec(b){let o=12,sr=22050,ch=1,bits=16,dO=-1,dL=0;while(o+8<=b.length){const id=b.toString('ascii',o,o+4),sz=b.readUInt32LE(o+4);if(id==='fmt '){ch=b.readUInt16LE(o+10);sr=b.readUInt32LE(o+12);bits=b.readUInt16LE(o+22);}else if(id==='data'){dO=o+8;dL=sz;}o+=8+sz+(sz%2);}const bp=bits/8,fb=bp*ch,n=Math.floor(dL/fb),m=new Float32Array(n);for(let i=0;i<n;i++){let s=0;for(let c=0;c<ch;c++)s+=b.readInt16LE(dO+(i*ch+c)*bp)/32768;m[i]=s/ch;}return{data:m,sr};}
function rs(x,f,t){if(f===t)return x;const r=f/t,o=new Float32Array(Math.floor(x.length/r));for(let i=0;i<o.length;i++){const ix=i*r,i0=Math.floor(ix),i1=Math.min(i0+1,x.length-1);o[i]=x[i0]+(x[i1]-x[i0])*(ix-i0);}return o;}
const roots=[];if(process.env.AKANSHA_WHISPER_BUNDLE)roots.push(process.env.AKANSHA_WHISPER_BUNDLE);const rp=process.resourcesPath;if(typeof rp==='string'&&rp)roots.push(require('path').join(rp,'voice','models'));roots.push(require('path').join(process.cwd(),'voice','models'));roots.push(require('path').join(process.cwd(),'..','voice','models'));
const mid=(process.env.AKANSHA_WHISPER_MODEL||'Xenova/whisper-base.en').split('/').filter(Boolean);
let root=null;for(const r of roots){try{if(fs.existsSync(require('path').join(r,...mid,'config.json'))){root=r;break;}}catch{}}
if(!root){console.log(JSON.stringify({ok:false,error:'bundled model not found'}));process.exit(0);}
const tf=require('@huggingface/transformers');const {pipeline,env}=tf;
env.localModelPath=root;env.allowLocalModels=true;env.allowRemoteModels=false;
(async()=>{try{const b=fs.readFileSync(process.env.AKANSHA_WAV);const {data,sr}=dec(b);const audio=rs(data,sr,16000);const t=await pipeline('automatic-speech-recognition',process.env.AKANSHA_WHISPER_MODEL||'Xenova/whisper-base.en');const out=await t(audio);console.log(JSON.stringify({ok:true,text:String((out&&out.text)||'').trim()}));}catch(e){console.log(JSON.stringify({ok:false,error:String((e&&e.message)||e)}));}})();
`;

export async function transcribeViaWorker(wav: Buffer, timeoutMs = 60000): Promise<{ text: string }> {
  const dir = mkdtempSync(join(tmpdir(), 'akan-wav-'));
  const file = join(dir, 'speech.wav');
  try {
    writeFileSync(file, wav);
    const env: NodeJS.ProcessEnv = { ...process.env, ELECTRON_RUN_AS_NODE: '1', AKANSHA_WAV: file };
    if (!env.AKANSHA_WHISPER_MODEL) env.AKANSHA_WHISPER_MODEL = 'Xenova/whisper-base.en';
    const child = spawn(process.execPath, ['-e', WORKER, file], { env, cwd: process.cwd() });
    const out = await new Promise<string>((resolve, reject) => {
      let buf = '';
      let err = '';
      const to = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* ignore */ } reject(new Error('whisper worker timeout')); }, timeoutMs);
      child.stdout.on('data', (d) => { buf += String(d); });
      child.stderr.on('data', (d) => { err += String(d); });
      child.on('error', (e) => { clearTimeout(to); reject(e); });
      child.on('close', () => { clearTimeout(to); resolve(buf || (err ? `{"ok":false,"error":${JSON.stringify(err.slice(0, 200))}}` : '')); });
    });
    const line = out.trim().split('\n').filter(Boolean).pop() || '';
    const parsed = JSON.parse(line) as { ok?: boolean; text?: string; error?: string };
    if (!parsed || parsed.ok !== true) throw new Error(parsed?.error || 'whisper worker returned no result');
    return { text: String(parsed.text || '') };
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}
