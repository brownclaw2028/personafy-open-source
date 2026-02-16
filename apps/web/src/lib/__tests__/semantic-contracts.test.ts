import { describe, expect, it } from 'vitest';
import { inferSemanticDomainFromKey, routeDynamicKey, validateSemanticContract } from '../semantic-contracts';

describe('semantic contracts', () => {
  it('validates canonical contract with evidence lock', () => {
    const sourceText = 'I am vegetarian and I always buy lactose-free yogurt.';
    const contract = validateSemanticContract({
      domain: 'food',
      canonical_key: 'dietary.restrictions',
      dynamic_key: null,
      value: 'vegetarian',
      temporal_status: 'current',
      is_negation: false,
      evidence_snippet: 'I am vegetarian',
      confidence: 0.73,
      sensitivity: 'medium',
      source_id: 'r1',
      source_name: 'Record 1',
    }, sourceText);

    expect(contract).toBeTruthy();
    expect(contract?.canonical_key).toBe('dietary.restrictions');
    expect(contract?.dynamic_key).toBeNull();
  });

  it('rejects invalid key mode when both canonical and dynamic keys are present', () => {
    const contract = validateSemanticContract({
      domain: 'shopping',
      canonical_key: 'apparel.shoe.size',
      dynamic_key: 'dynamic.apparel.shoe_size',
      value: '10',
      temporal_status: 'current',
      is_negation: false,
      evidence_snippet: 'I wear size 10 shoes',
      confidence: 0.8,
      sensitivity: 'low',
      source_id: 'r2',
      source_name: 'Record 2',
    }, 'I wear size 10 shoes');

    expect(contract).toBeNull();
  });

  it('rejects contracts when evidence snippet is not present in source text', () => {
    const contract = validateSemanticContract({
      domain: 'travel',
      canonical_key: 'flight.seat_preference',
      dynamic_key: null,
      value: 'window seat',
      temporal_status: 'current',
      is_negation: false,
      evidence_snippet: 'I always choose a window seat',
      confidence: 0.8,
      sensitivity: 'low',
      source_id: 'r3',
      source_name: 'Record 3',
    }, 'I usually choose aisle seats for work trips.');

    expect(contract).toBeNull();
  });

  it('infers semantic domain from normalized key prefixes', () => {
    expect(inferSemanticDomainFromKey('travel.hotel_chain')).toBe('travel');
    expect(inferSemanticDomainFromKey('food.favorite_cuisines')).toBe('food');
    expect(inferSemanticDomainFromKey('work.tools')).toBe('work');
  });

  it('routes dynamic keys to dynamic.* namespace', () => {
    expect(routeDynamicKey('pet.dog.breed')).toBe('dynamic.pet.dog.breed');
    expect(routeDynamicKey('dynamic.hobbies.photography')).toBe('dynamic.hobbies.photography');
  });

  it('normalizes dynamic_key contracts into dynamic.* namespace', () => {
    const sourceText = 'I collect vintage cameras and shoot film every weekend.';
    const contract = validateSemanticContract({
      domain: 'general',
      canonical_key: null,
      dynamic_key: 'hobbies.photography',
      value: 'film photography',
      temporal_status: 'current',
      is_negation: false,
      evidence_snippet: 'shoot film every weekend',
      confidence: 0.74,
      sensitivity: 'low',
      source_id: 'dyn-1',
      source_name: 'Dynamic source',
    }, sourceText);

    expect(contract).toBeTruthy();
    expect(contract?.dynamic_key).toBe('dynamic.hobbies.photography');
    expect(contract?.canonical_key).toBeNull();
  });
});
