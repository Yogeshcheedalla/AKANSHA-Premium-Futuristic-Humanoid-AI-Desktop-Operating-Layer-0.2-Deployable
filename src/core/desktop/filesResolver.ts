import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export interface FileSearchResult {
  path: string;
  name: string;
  directory: string;
}

/**
 * Uses Windows Search (via PowerShell) to find files matching a query.
 */
export async function searchFiles(query: string, maxResults = 5): Promise<FileSearchResult[]> {
  const psScript = `
    $ErrorActionPreference = 'SilentlyContinue'
    $docs = [Environment]::GetFolderPath('MyDocuments')
    $desk = [Environment]::GetFolderPath('Desktop')
    $paths = @($docs, $desk)
    
    $results = Get-ChildItem -Path $paths -Filter "*${query}*" -Recurse -File -Depth 3 | Select-Object -First ${maxResults} FullName, Name, DirectoryName
    
    $results | ForEach-Object {
      [PSCustomObject]@{
        path = $_.FullName
        name = $_.Name
        directory = $_.DirectoryName
      }
    } | ConvertTo-Json -Compress
  `;

  try {
    const { stdout } = await execAsync(`powershell -NoProfile -Command "${psScript.replace(/"/g, '\\"')}"`, { timeout: 8000 });
    if (!stdout.trim()) return [];
    
    const raw = JSON.parse(stdout);
    const parsed = Array.isArray(raw) ? raw : [raw];
    return parsed.map((p: any) => ({
      path: p.path,
      name: p.name,
      directory: p.directory
    }));
  } catch (e) {
    console.error('[FilesResolver] Search failed:', e);
    return [];
  }
}
