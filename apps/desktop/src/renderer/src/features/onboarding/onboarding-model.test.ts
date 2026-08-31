import { describe, expect, it } from 'vitest';

import {
  createOnboardingDraft,
  canManageOnboarding,
  hasCompletedOnboardingSale,
  hasOnboardingMembership,
  nextOnboardingStep,
  parseOnboardingDraft,
} from './onboarding-model';

describe('onboarding model', () => {
  it('allows OWNER and ADMIN but denies COACH', () => {
    expect(canManageOnboarding('OWNER')).toBe(true);
    expect(canManageOnboarding('ADMIN')).toBe(true);
    expect(canManageOnboarding('COACH')).toBe(false);
  });

  it('restores only the same operator safe workflow identifiers', () => {
    const draft = createOnboardingDraft({ actorId: 'owner-1', leadId: 'lead-1' });
    expect(parseOnboardingDraft(JSON.stringify(draft), 'owner-1')).toEqual(draft);
    expect(parseOnboardingDraft(JSON.stringify(draft), 'admin-2')).toBeNull();
    expect(parseOnboardingDraft('{broken', 'owner-1')).toBeNull();
  });

  it('treats only a current canonical membership as completed', () => {
    const profile = {
      groups: [
        {
          groupId: 'old-group',
          joinedAt: '2026-01-01T00:00:00.000Z',
          membershipStatus: 'LEFT',
          segment: 'FORMER',
        },
        {
          groupId: 'new-group',
          joinedAt: '2026-08-31T00:00:00.000Z',
          membershipStatus: 'ACTIVE',
          segment: 'FUTURE',
        },
      ],
    } as never;
    expect(hasOnboardingMembership(profile, 'old-group', '2026-08-31')).toBe(false);
    expect(hasOnboardingMembership(profile, 'new-group', '2026-08-31')).toBe(true);
    expect(hasOnboardingMembership(profile, 'new-group', '2026-08-30')).toBe(false);
  });

  it('accepts an existing fully paid canonical subscription and rejects partial payment', () => {
    const subscriptions = [
      {
        debt: 0,
        id: 'old',
        paidAmount: 1_000,
        paymentStatus: 'PAID',
        salePrice: 1_000,
      },
      {
        debt: 500,
        id: 'partial',
        paidAmount: 500,
        paymentStatus: 'PARTIALLY_PAID',
        salePrice: 1_000,
      },
    ];
    const finance = {
      subscriptions,
    } as never;
    expect(hasCompletedOnboardingSale(finance)).toBe(true);
    expect(hasCompletedOnboardingSale({ subscriptions: subscriptions.slice(1) } as never)).toBe(
      false,
    );
    expect(
      hasCompletedOnboardingSale({
        subscriptions: [
          ...subscriptions,
          {
            debt: 0,
            id: 'new',
            paidAmount: 1_000,
            paymentStatus: 'PAID',
            salePrice: 1_000,
          },
        ],
      } as never),
    ).toBe(true);
  });

  it('does not advance group or payment until canonical completion', () => {
    expect(
      nextOnboardingStep('GROUP', {
        hasMembership: false,
        hasPaidSubscription: false,
        hasStudent: true,
      }),
    ).toBe('GROUP');
    expect(
      nextOnboardingStep('DOCUMENTS', {
        hasMembership: true,
        hasPaidSubscription: false,
        hasStudent: true,
      }),
    ).toBe('PAYMENT');
    expect(
      nextOnboardingStep('PAYMENT', {
        hasMembership: true,
        hasPaidSubscription: false,
        hasStudent: true,
      }),
    ).toBe('PAYMENT');
    expect(
      nextOnboardingStep('PAYMENT', {
        hasMembership: true,
        hasPaidSubscription: true,
        hasStudent: true,
      }),
    ).toBe('CARD');
    expect(
      nextOnboardingStep('CARD', {
        hasMembership: true,
        hasPaidSubscription: true,
        hasStudent: true,
      }),
    ).toBe('DONE');
  });
});
