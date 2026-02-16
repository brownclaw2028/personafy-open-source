import React, { useState } from 'react';
import { Check } from 'lucide-react';
import type { FollowUpQuestion } from '../lib/types';

interface FollowUpCardProps {
  question: FollowUpQuestion;
  onAnswer: (questionId: string, answer: string) => void;
  isAnswered: boolean;
}

export function FollowUpCard({ question, onAnswer, isAnswered }: FollowUpCardProps) {
  const [answer, setAnswer] = useState('');
  const [selectedOption, setSelectedOption] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!answer.trim() && !selectedOption) return;
    
    setIsSubmitting(true);
    
    // Simulate a brief delay for better UX
    await new Promise(resolve => setTimeout(resolve, 300));
    
    const finalAnswer = question.type === 'multiple-choice' ? selectedOption : answer.trim();
    onAnswer(question.id, finalAnswer);
    
    setIsSubmitting(false);
  };

  const getImportanceColor = (importance: string) => {
    switch (importance) {
      case 'high': return 'border-red-500/30 bg-red-500/5';
      case 'medium': return 'border-yellow-500/30 bg-yellow-500/5';
      default: return 'border-blue-500/30 bg-blue-500/5';
    }
  };

  const getImportanceBadge = (importance: string) => {
    switch (importance) {
      case 'high': return 'bg-red-500/20 text-red-400 border-red-500/30';
      case 'medium': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
      default: return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
    }
  };

  if (isAnswered) {
    return (
      <div className="glass-card p-6 bg-green-500/5 border-green-500/30 animate-fade-in">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center">
            <Check className="w-5 h-5 text-white" />
          </div>
          <div>
            <p className="text-green-400 font-medium">Thanks!</p>
            <p className="text-text-secondary text-sm">{question.question}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`glass-card p-6 ${getImportanceColor(question.importance)}`}>
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-sm text-text-tertiary">{question.persona}</span>
            <span className={`px-2 py-1 rounded text-xs font-medium border ${getImportanceBadge(question.importance)}`}>
              {question.importance}
            </span>
          </div>
          <h3 className="text-lg font-medium text-white">{question.question}</h3>
        </div>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-4">
        {question.type === 'text' && (
          <input
            type="text"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder="Type your answer..."
            className="w-full px-4 py-3 bg-black/20 border border-card-border/50 rounded-lg text-white placeholder-text-tertiary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 transition-all"
            disabled={isSubmitting}
          />
        )}

        {question.type === 'multiple-choice' && question.options && (
          <div className="space-y-2">
            {question.options.map((option) => (
              <label
                key={option}
                className="flex items-center gap-3 p-3 bg-black/20 border border-card-border/50 rounded-lg cursor-pointer hover:bg-black/30 transition-colors"
              >
                <input
                  type="radio"
                  name={question.id}
                  value={option}
                  checked={selectedOption === option}
                  onChange={(e) => setSelectedOption(e.target.value)}
                  className="w-4 h-4 text-accent bg-transparent border-2 border-card-border/50 focus:ring-accent focus:ring-2"
                  disabled={isSubmitting}
                />
                <span className="text-white">{option}</span>
              </label>
            ))}
          </div>
        )}

        {question.type === 'boolean' && (
          <div className="flex gap-4">
            {['Yes', 'No'].map((option) => (
              <label
                key={option}
                className="flex items-center gap-2 p-3 bg-black/20 border border-card-border/50 rounded-lg cursor-pointer hover:bg-black/30 transition-colors flex-1 justify-center"
              >
                <input
                  type="radio"
                  name={question.id}
                  value={option}
                  checked={selectedOption === option}
                  onChange={(e) => setSelectedOption(e.target.value)}
                  className="w-4 h-4 text-accent bg-transparent border-2 border-card-border/50 focus:ring-accent focus:ring-2"
                  disabled={isSubmitting}
                />
                <span className="text-white font-medium">{option}</span>
              </label>
            ))}
          </div>
        )}

        {/* Submit Button */}
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={
              isSubmitting || 
              (question.type === 'text' && !answer.trim()) ||
              ((question.type === 'multiple-choice' || question.type === 'boolean') && !selectedOption)
            }
            className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed min-w-24"
          >
            {isSubmitting ? (
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                <span>Saving...</span>
              </div>
            ) : (
              'Submit'
            )}
          </button>
        </div>
      </form>
    </div>
  );
}