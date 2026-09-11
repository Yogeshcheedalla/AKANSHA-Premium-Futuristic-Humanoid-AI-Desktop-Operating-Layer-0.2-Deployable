export interface IntentResult {
  intent: 'conversation' | 'question' | 'command' | 'mission' | 'information_request' | 'research' | 'coding' | 'automation' | 'unknown';
  entities: string[];
  confidence: number;
  requiresConfirmation: boolean;
  riskLevel: 'low' | 'medium' | 'high';
  requiredPermissions: string[];
}

/** Imperative verbs that indicate a concrete, executable action. */
const IMPERATIVE_VERBS =
  /\b(open|close|launch|start|stop|kill|terminate|run|execute|write|create|build|generate|make|search|find|look up|save|read|click|type|send|install|uninstall|delete|remove|move|copy|rename|download|upload|summarize|schedule|monitor|watch|alert|remember|forget|format|wipe|erase|nuke|truncate|drop|purge|reset)\b/gi;

/** Explicit sequencing markers that unambiguously mean "multi-step". */
const SEQUENCE_MARKERS =
  /\b(then|after that|and then|next,|finally|once you(?:'re| are) done|when (?:you(?:'re| are)|it(?:'s| is)) done)\b/i;

/** Artifact nouns that make a single create/build verb a mission, not chat. */
const ARTIFACT = /\b(report|document|file|folder|email|message|note|post|code|script|program|website|app|application|presentation|spreadsheet)\b/i;

export class IntentEngine {
  private conversationRe = /^(hello|hi|hey|good morning|good evening|good afternoon|how are you|how's it going|what's up|sup|yo|thanks|thank you)\b/i;
  private commandRe = /^(open|close|start|stop|run|launch|execute|kill|terminate|pause|resume|show|hide|minimize|maximize)\b/i;
  private researchRe = /^(research|find|search|look up|investigate|analyze|study|what(?:'s| is) the latest|latest news)\b/i;
  private codingRe = /^(code|program|write (?:code|a (?:script|program|function))|create (?:a )?(?:script|program|function)|build (?:a |an |this |the )?(?:feature|app|application|function|module|api|website|program|code)|develop|debug|refactor|fix (?:the |this )?(?:bug|code|error))\b/i;
  private automationRe = /^(automate|schedule|trigger|monitor|watch|alert me)\b/i;
  private infoRe = /\b(what|whats|what's|how|why|when|where|who|which|explain|define|describe|tell me|difference between|meaning of)\b/i;

  detect(text: string): IntentResult {
    const lower = (text || '').toLowerCase().trim();

    // 0. Empty / trivial → conversation.
    if (!lower || lower.length < 3) {
      return this.conversation();
    }

    // 1. Conversation / greetings — checked FIRST so a greeting is never
    //    mistaken for an action ("how are you" must not look like a question
    //    needing tools, and must never route to execution).
    if (this.conversationRe.test(lower)) {
      return this.conversation();
    }

    const verbCount = (lower.match(IMPERATIVE_VERBS) || []).length;
    const hasSequence = SEQUENCE_MARKERS.test(lower);
    const startsWithArtifact = this.codingRe.test(lower) || /^(create|build|make|generate|write)\b/i.test(lower);

    // 2. Multi-step mission — explicit sequencing, or 2+ imperative verbs
    //    (e.g. "Open Chrome, search X, read the result, and save the summary"),
    //    or a create/build verb aimed at an artifact ("Create a report").
    if (hasSequence || verbCount >= 2 || (startsWithArtifact && ARTIFACT.test(lower))) {
      return {
        intent: 'mission',
        entities: [text],
        confidence: 0.85,
        requiresConfirmation: false,
        riskLevel: 'medium',
        requiredPermissions: ['READ_FILES', 'WRITE_FILES', 'EXECUTE_COMMANDS'],
      };
    }

    // 3. Coding — specific, before generic command/research so "build a
    //    feature" is not swallowed by the command verb "build".
    if (this.codingRe.test(lower)) {
      return {
        intent: 'coding',
        entities: [text],
        confidence: 0.83,
        requiresConfirmation: false,
        riskLevel: 'low',
        requiredPermissions: ['READ_FILES', 'WRITE_FILES', 'EXECUTE_COMMANDS'],
      };
    }

    // 4. Research / web lookup.
    if (this.researchRe.test(lower)) {
      return {
        intent: 'research',
        entities: [text],
        confidence: 0.82,
        requiresConfirmation: false,
        riskLevel: 'low',
        requiredPermissions: ['NETWORK_ACCESS', 'READ_EXTERNAL_DATA'],
      };
    }

    // 5. Automation / background.
    if (this.automationRe.test(lower)) {
      return {
        intent: 'automation',
        entities: [text],
        confidence: 0.8,
        requiresConfirmation: false,
        riskLevel: 'medium',
        requiredPermissions: ['EXECUTE_COMMANDS', 'BACKGROUND_TASKS'],
      };
    }

    // 6. Single Windows/desktop command.
    if (this.commandRe.test(lower) || verbCount === 1) {
      const destructive = /\b(delete|remove|format|wipe|erase|drop|uninstall)\b/i.test(lower);
      return {
        intent: 'command',
        entities: [text],
        confidence: 0.88,
        requiresConfirmation: destructive,
        riskLevel: destructive ? 'high' : 'medium',
        requiredPermissions: ['EXECUTE_COMMANDS', 'WINDOWS_CONTROL'],
      };
    }

    // 7. Information request / question.
    if (this.infoRe.test(lower)) {
      return {
        intent: 'information_request',
        entities: [text],
        confidence: 0.78,
        requiresConfirmation: false,
        riskLevel: 'low',
        requiredPermissions: [],
      };
    }

    // 8. Anything else is unknown — never silently executed.
    return {
      intent: 'unknown',
      entities: [text],
      confidence: 0.5,
      requiresConfirmation: true,
      riskLevel: 'medium',
      requiredPermissions: [],
    };
  }

  private conversation(): IntentResult {
    return {
      intent: 'conversation',
      entities: [],
      confidence: 0.92,
      requiresConfirmation: false,
      riskLevel: 'low',
      requiredPermissions: [],
    };
  }

  classify(text: string): string {
    return this.detect(text).intent;
  }
}

export const intentEngine = new IntentEngine();
