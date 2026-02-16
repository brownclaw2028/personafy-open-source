import { useState } from 'react';
import type { ProfileSummary, Persona, FollowUpQuestion } from '../lib/types';
import { PersonaCard } from '../components/PersonaCard';
import { FollowUpCard } from '../components/FollowUpCard';

interface ImportReviewProps {
  profileSummary: ProfileSummary;
  personas: Persona[];
  followUpQuestions: FollowUpQuestion[];
  onAnswerFollowUp: (questionId: string, answer: string) => void;
  onVaultCreated: () => void;
}

export function ImportReview({
  profileSummary,
  personas,
  followUpQuestions,
  onAnswerFollowUp,
  onVaultCreated
}: ImportReviewProps) {
  const [answeredQuestions, setAnsweredQuestions] = useState<Set<string>>(new Set());
  
  const handleAnswerQuestion = (questionId: string, answer: string) => {
    onAnswerFollowUp(questionId, answer);
    setAnsweredQuestions(prev => new Set([...prev, questionId]));
  };

  const getConfidenceBadge = (confidence: number) => {
    if (confidence >= 0.8) return 'confidence-high';
    if (confidence >= 0.6) return 'confidence-medium';
    return 'confidence-low';
  };

  const getConfidenceText = (confidence: number) => {
    if (confidence >= 0.8) return 'High';
    if (confidence >= 0.6) return 'Medium';
    return 'Growing';
  };

  return (
    <div className="min-h-screen bg-background py-8 px-4">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold mb-4 bg-gradient-primary bg-clip-text text-transparent">
            Welcome to Your Personal Vault
          </h1>
          <p className="text-text-secondary text-lg">
            We've analyzed your conversations and created your digital personas
          </p>
        </div>

        {/* Section A: Here's Who You Are */}
        <section className="mb-16">
          <h2 className="text-2xl font-bold mb-8 text-center">
            Here's who you are
          </h2>
          
          {/* Narrative Summary */}
          <div className="glass-card p-8 mb-8 text-center animate-fade-in">
            <p className="text-lg leading-relaxed text-text-primary">
              {profileSummary.narrative}
            </p>
            
            {/* Confidence Badge */}
            <div className="mt-6 flex justify-center">
              <span 
                className={`px-4 py-2 rounded-full text-sm font-medium ${getConfidenceBadge(profileSummary.confidence)}`}
              >
                {getConfidenceText(profileSummary.confidence)} Confidence
              </span>
            </div>
          </div>

          {/* Key Traits */}
          <div className="flex flex-wrap justify-center gap-3 mb-12">
            {profileSummary.keyTraits.map((trait, index) => (
              <span
                key={trait}
                className="px-4 py-2 bg-card border border-card-border/50 rounded-full text-sm font-medium text-accent animate-fade-in"
                style={{ animationDelay: `${index * 0.1}s` }}
              >
                {trait}
              </span>
            ))}
          </div>

          {/* Persona Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {personas.map((persona, index) => (
              <div
                key={persona.id}
                className="animate-slide-up"
                style={{ animationDelay: `${index * 0.1}s` }}
              >
                <PersonaCard persona={persona} />
              </div>
            ))}
          </div>
        </section>

        {/* Section B: Follow-Up Questions */}
        {followUpQuestions.length > 0 && (
          <section className="mb-16">
            <h2 className="text-2xl font-bold mb-8 text-center">
              A few things we'd love to know
            </h2>
            <p className="text-text-secondary text-center mb-12">
              Help us make your personas even more accurate by answering these quick questions
            </p>
            
            <div className="space-y-6 max-w-2xl mx-auto">
              {followUpQuestions.map((question, index) => (
                <div
                  key={question.id}
                  className="animate-fade-in"
                  style={{ animationDelay: `${(index + 3) * 0.1}s` }}
                >
                  <FollowUpCard
                    question={question}
                    onAnswer={handleAnswerQuestion}
                    isAnswered={answeredQuestions.has(question.id)}
                  />
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Create Vault Button */}
        <div className="text-center">
          <button
            onClick={onVaultCreated}
            className="btn-primary text-lg px-12 py-4 animate-fade-in"
            style={{ animationDelay: '0.8s' }}
          >
            Create My Vault
          </button>
          <p className="text-text-tertiary text-sm mt-4">
            Your data stays private and secure on your device
          </p>
        </div>
      </div>
    </div>
  );
}