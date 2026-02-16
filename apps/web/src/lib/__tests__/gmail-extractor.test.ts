import { describe, expect, it } from 'vitest';
import { GmailExtractor, type GmailEmail } from '../gmail-extractor';

function extractFacts(emails: GmailEmail[]) {
  return new GmailExtractor(emails).getAllFacts();
}

describe('GmailExtractor', () => {
  it('normalizes .example.com food senders and avoids shopping-budget misclassification', () => {
    const emails: GmailEmail[] = [
      {
        id: 'email-food-1',
        from: 'updates@doordash.example.com',
        to: 'user@example.com',
        subject: 'Your DoorDash order from Tex-Mex Express is on its way',
        body: 'Order total $42.15. Delivery arriving in 18 minutes.',
        date: '2026-02-01T10:00:00Z',
        labels: ['Inbox'],
      },
    ];

    const facts = extractFacts(emails);

    expect(
      facts.some((fact) => fact.key === 'food.delivery_services' && fact.value === 'DoorDash'),
    ).toBe(true);
    expect(facts.some((fact) => fact.key === 'budget.monthly_clothing')).toBe(false);
  });

  it('does not extract apparel.shoe.size from non-shoe size text', () => {
    const emails: GmailEmail[] = [
      {
        id: 'email-shopping-1',
        from: 'orders@nike.com',
        to: 'user@example.com',
        subject: 'Order confirmation',
        body: 'Thanks for your purchase. Waist size 32. Inseam 30. Total $88.50.',
        date: '2026-02-01T11:00:00Z',
        labels: ['Inbox'],
      },
    ];

    const facts = extractFacts(emails);

    expect(facts.some((fact) => fact.key === 'apparel.shoe.size')).toBe(false);
  });

  it('does not infer clothing budget from non-clothing order receipts', () => {
    const emails: GmailEmail[] = [
      {
        id: 'email-shopping-2',
        from: 'orders@amazon.com',
        to: 'user@example.com',
        subject: 'Order confirmation',
        body: 'USB-C cable order confirmed. Total $79.99. Delivery tomorrow.',
        date: '2026-02-01T12:00:00Z',
        labels: ['Inbox'],
      },
    ];

    const facts = extractFacts(emails);

    expect(facts.some((fact) => fact.key === 'budget.monthly_clothing')).toBe(false);
  });
});
