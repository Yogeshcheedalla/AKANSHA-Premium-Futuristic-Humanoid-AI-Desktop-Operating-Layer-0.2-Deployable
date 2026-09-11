export interface EvaluationResult {
  score: number; // 0-1
  dimensions: {
    completeness: number;
    accuracy: number;
    consistency: number;
    relevance: number;
    quality: number;
  };
  weaknesses: string[];
  strengths: string[];
  improvementPlan: string[];
  recommendation: 'accept' | 'revise' | 'reject';
  timestamp: number;
}

export class Evaluator {
  evaluateArtifact(
    artifactType: string,
    content: string | Record<string, any>,
    criteria: { [key: string]: number }
  ): EvaluationResult {
    // Simplified evaluation logic
    const completeness = criteria.completeness || 0.8;
    const accuracy = criteria.accuracy || 0.85;
    const consistency = criteria.consistency || 0.75;
    const relevance = criteria.relevance || 0.9;
    const quality = criteria.quality || 0.7;
    
    const score = (completeness + accuracy + consistency + relevance + quality) / 5;
    
    const weaknesses: string[] = [];
    const strengths: string[] = [];
    const improvements: string[] = [];
    
    if (completeness < 0.7) weaknesses.push('Incomplete');
    if (accuracy < 0.8) weaknesses.push('Potential inaccuracies');
    if (quality < 0.75) weaknesses.push('Quality below standard');
    
    if (relevance >= 0.85) strengths.push('Highly relevant');
    if (accuracy >= 0.9) strengths.push('Highly accurate');
    
    if (score < 0.7) {
      improvements.push('Review and revise content for completeness');
      improvements.push('Check sources and accuracy');
      improvements.push('Improve structure and quality');
    } else if (score < 0.85) {
      improvements.push('Minor refinements recommended');
    }
    
    return {
      score,
      dimensions: { completeness, accuracy, consistency, relevance, quality },
      weaknesses,
      strengths,
      improvementPlan: improvements,
      recommendation: score >= 0.8 ? 'accept' : score >= 0.6 ? 'revise' : 'reject',
      timestamp: Date.now(),
    };
  }

  compareVersions(original: any, revised: any): { improved: boolean; delta: string[] } {
    const delta: string[] = [];
    const improved = JSON.stringify(revised) !== JSON.stringify(original);
    if (improved) {
      delta.push('Content has been modified');
    }
    return { improved, delta };
  }
}

export const evaluator = new Evaluator();
