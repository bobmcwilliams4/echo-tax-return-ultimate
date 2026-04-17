// ═══════════════════════════════════════════════════════════════════════════
// ECHO TAX RETURN ULTIMATE — Billing Routes
// Stripe subscription management, usage tracking, webhooks
// ═══════════════════════════════════════════════════════════════════════════

import { Hono } from 'hono';
import { Database } from 'bun:sqlite';
import { getById, logAudit } from '../services/database';
import { createLogger } from '../utils/logger';
import { z } from 'zod';

const log = createLogger('billing');

// ─── Subscription Tier Definitions ─────────────────────────────────────
const TIER_LIMITS: Record<string, { returns_per_year: number; engines: number; claude_queries: number; api_calls_per_day: number; price_monthly: number }> = {
  free: { returns_per_year: 1, engines: 3, claude_queries: 5, api_calls_per_day: 100, price_monthly: 0 },
  pro: { returns_per_year: 5, engines: 8, claude_queries: 50, api_calls_per_day: 1_000, price_monthly: 29 },
  business: { returns_per_year: 25, engines: 14, claude_queries: 200, api_calls_per_day: 5_000, price_monthly: 79 },
  professional: { returns_per_year: 500, engines: 14, claude_queries: 1_000, api_calls_per_day: 25_000, price_monthly: 199 },
  enterprise: { returns_per_year: -1, engines: 14, claude_queries: -1, api_calls_per_day: -1, price_monthly: 499 },
};

// ─── Stripe Price IDs ──────────────────────────────────────────────────
const STRIPE_PRICE_IDS: Record<string, string> = {
  pro: process.env.STRIPE_PRICE_PRO || 'price_pro_placeholder',
  business: process.env.STRIPE_PRICE_BUSINESS || 'price_business_placeholder',
  professional: process.env.STRIPE_PRICE_PROFESSIONAL || 'price_professional_placeholder',
  enterprise: process.env.STRIPE_PRICE_ENTERPRISE || 'price_enterprise_placeholder',
};

const SubscribeSchema = z.object({
  user_id: z.string().min(1),
  tier: z.enum(['pro', 'business', 'professional', 'enterprise']),
  stripe_customer_id: z.string().optional(),
  stripe_payment_method: z.string().optional(),
});

export function billingRoutes(db: Database) {
  const router = new Hono();

  // POST /subscribe — Create or update subscription
  router.post('/subscribe', async (c) => {
    const body = await c.req.json();
    const parsed = SubscribeSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ success: false, error: 'Validation failed', details: parsed.error.flatten() }, 400);
    }

    const input = parsed.data;
    const tierInfo = TIER_LIMITS[input.tier];
    if (!tierInfo) return c.json({ success: false, error: 'Invalid tier' }, 400);

    // Check for existing subscription
    const existing = db.prepare('SELECT * FROM subscriptions WHERE user_id = ? AND status IN (?, ?)').get(
      input.user_id, 'active', 'trialing',
    ) as Record<string, unknown> | undefined;

    const now = new Date();
    const periodEnd = new Date(now);
    periodEnd.setMonth(periodEnd.getMonth() + 1);

    if (existing) {
      // Upgrade/downgrade existing subscription
      db.prepare(`
        UPDATE subscriptions SET tier = ?, stripe_customer_id = COALESCE(?, stripe_customer_id),
          current_period_start = ?, current_period_end = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(
        input.tier, input.stripe_customer_id || null,
        now.toISOString(), periodEnd.toISOString(), existing.id,
      );

      logAudit(db, {
        user_id: c.get('userId'),
        action: 'subscription_updated',
        entity_type: 'subscription',
        entity_id: existing.id as string,
        details: { old_tier: existing.tier, new_tier: input.tier },
      });

      log.info({ userId: input.user_id, tier: input.tier }, 'Subscription updated');
      return c.json({
        success: true,
        data: {
          subscription_id: existing.id,
          tier: input.tier,
          status: 'active',
          limits: tierInfo,
          period_end: periodEnd.toISOString(),
          action: 'upgraded',
        },
      });
    }

    // Create new subscription
    const subId = crypto.randomUUID().replace(/-/g, '');

    db.prepare(`
      INSERT INTO subscriptions (id, user_id, stripe_customer_id, tier, status, current_period_start, current_period_end)
      VALUES (?, ?, ?, ?, 'active', ?, ?)
    `).run(
      subId, input.user_id, input.stripe_customer_id || null,
      input.tier, now.toISOString(), periodEnd.toISOString(),
    );

    logAudit(db, {
      user_id: c.get('userId'),
      action: 'subscription_created',
      entity_type: 'subscription',
      entity_id: subId,
      details: { tier: input.tier, price: tierInfo.price_monthly },
    });

    log.info({ userId: input.user_id, tier: input.tier, subId }, 'New subscription created');

    return c.json({
      success: true,
      data: {
        subscription_id: subId,
        tier: input.tier,
        status: 'active',
        limits: tierInfo,
        period_start: now.toISOString(),
        period_end: periodEnd.toISOString(),
        price_monthly: tierInfo.price_monthly,
        stripe_price_id: STRIPE_PRICE_IDS[input.tier],
      },
    }, 201);
  });

  // GET /usage — Current usage statistics
  router.get('/usage', (c) => {
    const userId = c.req.query('user_id') || c.get('userId');
    if (!userId) return c.json({ success: false, error: 'user_id required' }, 400);

    // Get subscription
    const subscription = db.prepare(
      "SELECT * FROM subscriptions WHERE user_id = ? AND status IN ('active', 'trialing') ORDER BY created_at DESC LIMIT 1"
    ).get(userId) as Record<string, unknown> | undefined;

    const tier = (subscription?.tier as string) || 'free';
    const limits = TIER_LIMITS[tier] || TIER_LIMITS.free;

    // Returns filed this year
    const currentYear = new Date().getFullYear();
    const returnsFiled = db.prepare(`
      SELECT COUNT(*) as count FROM tax_returns t
      JOIN clients c ON t.client_id = c.id
      WHERE c.user_id = ? AND t.status IN ('filed', 'accepted') AND t.tax_year = ?
    `).get(userId, currentYear) as { count: number };

    // API calls today
    const today = new Date().toISOString().split('T')[0];
    const apiCallsToday = db.prepare(`
      SELECT COUNT(*) as count FROM api_usage WHERE user_id = ? AND timestamp >= ?
    `).get(userId, today) as { count: number };

    // Engine queries this month
    const monthStart = `${currentYear}-${String(new Date().getMonth() + 1).padStart(2, '0')}-01`;
    const engineQueries = db.prepare(`
      SELECT COUNT(*) as count FROM engine_queries
      WHERE created_at >= ? AND engine_id = 'CLAUDE'
    `).get(monthStart) as { count: number };

    // API call breakdown by endpoint (top 10)
    const topEndpoints = db.prepare(`
      SELECT endpoint, COUNT(*) as count, AVG(response_time_ms) as avg_response_ms
      FROM api_usage WHERE user_id = ? AND timestamp >= ?
      GROUP BY endpoint ORDER BY count DESC LIMIT 10
    `).all(userId, monthStart) as Record<string, unknown>[];

    return c.json({
      success: true,
      data: {
        user_id: userId,
        subscription: {
          tier,
          status: subscription?.status || 'free',
          period_end: subscription?.current_period_end || null,
        },
        usage: {
          returns_filed: {
            used: returnsFiled.count,
            limit: limits.returns_per_year,
            remaining: limits.returns_per_year === -1 ? 'unlimited' : Math.max(0, limits.returns_per_year - returnsFiled.count),
          },
          api_calls_today: {
            used: apiCallsToday.count,
            limit: limits.api_calls_per_day,
            remaining: limits.api_calls_per_day === -1 ? 'unlimited' : Math.max(0, limits.api_calls_per_day - apiCallsToday.count),
          },
          claude_queries_month: {
            used: engineQueries.count,
            limit: limits.claude_queries,
            remaining: limits.claude_queries === -1 ? 'unlimited' : Math.max(0, limits.claude_queries - engineQueries.count),
          },
          engines_available: limits.engines,
        },
        top_endpoints: topEndpoints,
        tier_limits: limits,
      },
    });
  });

  // POST /webhook — Stripe webhook handler
  router.post('/webhook', async (c) => {
    const signature = c.req.header('stripe-signature');
    const rawBody = await c.req.text();

    // In production, verify stripe signature here
    // const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    // const event = stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);

    let event: { type: string; data: { object: Record<string, unknown> } };
    try {
      event = JSON.parse(rawBody);
    } catch {
      log.error('Invalid webhook payload');
      return c.json({ success: false, error: 'Invalid payload' }, 400);
    }

    log.info({ eventType: event.type }, 'Stripe webhook received');

    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const stripeSubId = sub.id as string;
        const customerId = sub.customer as string;
        const status = sub.status as string;

        // Map Stripe status to our status
        const mappedStatus = status === 'active' ? 'active'
          : status === 'trialing' ? 'trialing'
          : status === 'past_due' ? 'past_due'
          : 'canceled';

        db.prepare(`
          UPDATE subscriptions SET status = ?, stripe_subscription_id = ?, updated_at = datetime('now')
          WHERE stripe_customer_id = ?
        `).run(mappedStatus, stripeSubId, customerId);

        log.info({ customerId, status: mappedStatus }, 'Subscription status updated via webhook');
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const customerId = sub.customer as string;

        db.prepare(`
          UPDATE subscriptions SET status = 'canceled', cancel_at = datetime('now'), updated_at = datetime('now')
          WHERE stripe_customer_id = ?
        `).run(customerId);

        log.info({ customerId }, 'Subscription canceled via webhook');
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const customerId = invoice.customer as string;

        db.prepare(`
          UPDATE subscriptions SET status = 'past_due', updated_at = datetime('now')
          WHERE stripe_customer_id = ?
        `).run(customerId);

        log.warn({ customerId }, 'Payment failed — subscription set to past_due');
        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        const customerId = invoice.customer as string;
        const periodEnd = new Date((invoice.period_end as number) * 1000).toISOString();

        db.prepare(`
          UPDATE subscriptions SET status = 'active', current_period_end = ?, updated_at = datetime('now')
          WHERE stripe_customer_id = ?
        `).run(periodEnd, customerId);

        log.info({ customerId, periodEnd }, 'Payment succeeded — subscription renewed');
        break;
      }

      default:
        log.debug({ eventType: event.type }, 'Unhandled webhook event type');
    }

    return c.json({ received: true });
  });

  return router;
}
