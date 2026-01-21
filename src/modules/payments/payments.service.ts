import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from 'src/services/database/database.service';
import { LoggerService } from 'src/services/logger/logger.service';
import Stripe from 'stripe';
import Decimal from 'decimal.js';
import { shouldMockPayments } from 'src/utils/environment.util';
import { PaymentStatus, CreditTransactionStatus, CreditTransactionType, SubscriptionStatus } from 'generated/prisma/enums';

@Injectable()
export class PaymentsService {
    private stripe: Stripe | null = null;

    constructor(
        private readonly databaseService: DatabaseService,
        private readonly configService: ConfigService,
        private readonly logger: LoggerService,
    ) {
        // Initialize Stripe only if not in development
        if (!shouldMockPayments()) {
            const stripeKey = this.configService.get<string>('STRIPE_SECRET_KEY');
            if (stripeKey) {
                this.stripe = new Stripe(stripeKey, { apiVersion: '2025-12-15.clover' as any });
            } else {
                this.logger.warn('STRIPE_SECRET_KEY not found, Stripe integration disabled', PaymentsService.name);
            }
        }
    }

    /**
     * Get or create Stripe customer for organization
     */
    async getOrCreateStripeCustomer(orgId: string, email?: string, name?: string): Promise<string> {
        // Check if Stripe customer already exists
        let stripeCustomer = await this.databaseService.stripeCustomer.findUnique({
            where: { organizationId: orgId },
        });

        if (stripeCustomer) {
            return stripeCustomer.stripeCustomerId;
        }

        // Skip Stripe API call in development
        if (shouldMockPayments()) {
            this.logger.log(`[DEV] Skipping Stripe customer creation for org ${orgId}`, PaymentsService.name);
            const mockCustomerId = `cus_dev_${orgId.substring(0, 8)}`;
            await this.databaseService.stripeCustomer.create({
                data: {
                    organizationId: orgId,
                    stripeCustomerId: mockCustomerId,
                    email: email || undefined,
                    name: name || undefined,
                    metadata: { dev: true },
                },
            });
            return mockCustomerId;
        }

        if (!this.stripe) {
            throw new BadRequestException('Stripe is not configured');
        }

        // Get organization details
        const org = await this.databaseService.organization.findUnique({
            where: { id: orgId },
            include: { owner: true },
        });

        if (!org) {
            throw new NotFoundException(`Organization ${orgId} not found`);
        }

        // Create Stripe customer
        const customer = await this.stripe.customers.create({
            email: email || org.owner.email || undefined,
            name: name || `${org.owner.firstName || ''} ${org.owner.lastName || ''}`.trim() || org.name,
            metadata: {
                organizationId: orgId,
            },
        });

        // Store in database
        stripeCustomer = await this.databaseService.stripeCustomer.create({
            data: {
                organizationId: orgId,
                stripeCustomerId: customer.id,
                email: customer.email || undefined,
                name: customer.name || undefined,
                metadata: customer.metadata as any,
            },
        });

        return stripeCustomer.stripeCustomerId;
    }

    /**
     * Create payment intent for credit purchase
     */
    async createPaymentIntent(
        orgId: string,
        amount: Decimal,
        currency: string,
        creditsAmount: Decimal,
    ): Promise<{ clientSecret: string; paymentIntentId: string }> {
        // Skip Stripe API call in development
        if (shouldMockPayments()) {
            this.logger.log(
                `[DEV] Skipping payment intent creation for org ${orgId}, amount: ${amount.toString()}, credits: ${creditsAmount.toString()}`,
                PaymentsService.name,
            );

            // Create mock payment record
            const payment = await this.databaseService.payment.create({
                data: {
                    organizationId: orgId,
                    amount,
                    currency,
                    creditsAmount,
                    status: 'PENDING',
                    stripePaymentId: `pi_dev_${Date.now()}`,
                    description: `Credit purchase: ${creditsAmount.toString()} credits`,
                },
            });

            return {
                clientSecret: `pi_dev_${payment.id}_secret_mock`,
                paymentIntentId: payment.stripePaymentId || payment.id,
            };
        }

        if (!this.stripe) {
            throw new BadRequestException('Stripe is not configured');
        }

        const stripeCustomerId = await this.getOrCreateStripeCustomer(orgId);

        // Create payment intent
        const paymentIntent = await this.stripe.paymentIntents.create({
            amount: Math.round(amount.times(100).toNumber()), // Convert to cents
            currency: currency.toLowerCase(),
            customer: stripeCustomerId,
            metadata: {
                organizationId: orgId,
                creditsAmount: creditsAmount.toString(),
            },
            description: `Credit purchase: ${creditsAmount.toString()} credits`,
        });

        // Store payment record
        const payment = await this.databaseService.payment.create({
            data: {
                organizationId: orgId,
                stripeCustomerId,
                amount,
                currency,
                creditsAmount,
                status: 'PENDING',
                stripePaymentId: paymentIntent.id,
                description: `Credit purchase: ${creditsAmount.toString()} credits`,
            },
        });

        return {
            clientSecret: paymentIntent.client_secret || '',
            paymentIntentId: paymentIntent.id,
        };
    }

    /**
     * Grant credits from successful payment
     */
    async grantCreditsFromPayment(paymentId: string): Promise<void> {
        const payment = await this.databaseService.payment.findUnique({
            where: { id: paymentId },
            include: { organization: true },
        });

        if (!payment) {
            throw new NotFoundException(`Payment ${paymentId} not found`);
        }

        if (payment.status !== 'SUCCEEDED') {
            throw new BadRequestException(`Payment ${paymentId} is not succeeded`);
        }

        // Check if credits already granted
        const existingTxn = await this.databaseService.creditTransaction.findFirst({
            where: {
                paymentId: payment.id,
                type: 'PURCHASE',
                status: 'COMPLETED',
            },
        });

        if (existingTxn) {
            this.logger.warn(`Credits already granted for payment ${paymentId}`, PaymentsService.name);
            return;
        }

        // Grant credits atomically
        await this.databaseService.$transaction(async (tx) => {
            const org = await tx.organization.findUnique({
                where: { id: payment.organizationId },
                select: { id: true, creditBalance: true, version: true },
            });

            if (!org) {
                throw new NotFoundException(`Organization ${payment.organizationId} not found`);
            }

            const newBalance = org.creditBalance.plus(payment.creditsAmount);
            const balanceBefore = org.creditBalance;
            const balanceAfter = newBalance;

            await Promise.all([
                tx.organization.update({
                    where: { id: payment.organizationId, version: org.version },
                    data: {
                        creditBalance: newBalance,
                        version: { increment: 1 },
                    },
                }),
                tx.creditTransaction.create({
                    data: {
                        organizationId: payment.organizationId,
                        type: 'PURCHASE',
                        status: 'COMPLETED',
                        amount: payment.creditsAmount,
                        balanceBefore,
                        balanceAfter,
                        paymentId: payment.id,
                        referenceType: 'payment',
                        referenceId: payment.id,
                        description: `Credits purchased via payment ${payment.id}`,
                        processedAt: new Date(),
                    },
                }),
            ]);
        });

        this.logger.log(
            `Credits granted: ${payment.creditsAmount.toString()} to org ${payment.organizationId} from payment ${paymentId}`,
            PaymentsService.name,
        );
    }

    /**
     * Handle Stripe webhook events
     */
    async handleStripeWebhook(event: Stripe.Event): Promise<void> {
        if (shouldMockPayments()) {
            this.logger.log(`[DEV] Skipping Stripe webhook: ${event.type}`, PaymentsService.name);
            return;
        }

        switch (event.type) {
            case 'payment_intent.succeeded': {
                const paymentIntent = event.data.object as Stripe.PaymentIntent;
                await this.handlePaymentIntentSucceeded(paymentIntent);
                break;
            }

            case 'payment_intent.payment_failed': {
                const paymentIntent = event.data.object as Stripe.PaymentIntent;
                await this.handlePaymentIntentFailed(paymentIntent);
                break;
            }

            case 'customer.subscription.created':
            case 'customer.subscription.updated': {
                const subscription = event.data.object as Stripe.Subscription;
                await this.handleSubscriptionUpdated(subscription);
                break;
            }

            case 'customer.subscription.deleted': {
                const subscription = event.data.object as Stripe.Subscription;
                await this.handleSubscriptionDeleted(subscription);
                break;
            }

            case 'invoice.paid': {
                const invoice = event.data.object as Stripe.Invoice;
                await this.handleInvoicePaid(invoice);
                break;
            }

            default:
                this.logger.log(`Unhandled Stripe webhook event: ${event.type}`, PaymentsService.name);
        }
    }

    /**
     * Handle payment intent succeeded
     */
    private async handlePaymentIntentSucceeded(paymentIntent: Stripe.PaymentIntent): Promise<void> {
        const payment = await this.databaseService.payment.findUnique({
            where: { stripePaymentId: paymentIntent.id },
        });

        if (!payment) {
            this.logger.warn(`Payment not found for Stripe payment intent ${paymentIntent.id}`, PaymentsService.name);
            return;
        }

        // Update payment status
        await this.databaseService.payment.update({
            where: { id: payment.id },
            data: {
                status: 'SUCCEEDED',
                stripeChargeId: paymentIntent.latest_charge as string | undefined,
                processedAt: new Date(),
                metadata: paymentIntent.metadata as any,
            },
        });

        // Grant credits
        await this.grantCreditsFromPayment(payment.id);
    }

    /**
     * Handle payment intent failed
     */
    private async handlePaymentIntentFailed(paymentIntent: Stripe.PaymentIntent): Promise<void> {
        const payment = await this.databaseService.payment.findUnique({
            where: { stripePaymentId: paymentIntent.id },
        });

        if (!payment) {
            return;
        }

        await this.databaseService.payment.update({
            where: { id: payment.id },
            data: {
                status: 'FAILED',
                failureReason: paymentIntent.last_payment_error?.message || 'Payment failed',
            },
        });
    }

    /**
     * Create subscription
     */
    async createSubscription(
        orgId: string,
        priceId: string,
        planName: string,
        monthlyCredits?: Decimal,
    ): Promise<{ subscriptionId: string; clientSecret?: string }> {
        // Skip Stripe API call in development
        if (shouldMockPayments()) {
            this.logger.log(
                `[DEV] Skipping subscription creation for org ${orgId}, plan: ${planName}`,
                PaymentsService.name,
            );

            const stripeCustomerId = await this.getOrCreateStripeCustomer(orgId);
            const mockSubscriptionId = `sub_dev_${Date.now()}`;

            const subscription = await this.databaseService.subscription.create({
                data: {
                    organizationId: orgId,
                    stripeCustomerId,
                    stripeSubscriptionId: mockSubscriptionId,
                    stripePriceId: priceId,
                    planName,
                    status: 'TRIALING',
                    currentPeriodStart: new Date(),
                    currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
                    monthlyCredits: monthlyCredits || undefined,
                },
            });

            return { subscriptionId: subscription.id };
        }

        if (!this.stripe) {
            throw new BadRequestException('Stripe is not configured');
        }

        const stripeCustomerId = await this.getOrCreateStripeCustomer(orgId);

        // Create subscription
        const subscription = await this.stripe.subscriptions.create({
            customer: stripeCustomerId,
            items: [{ price: priceId }],
            metadata: {
                organizationId: orgId,
                planName,
                monthlyCredits: monthlyCredits?.toString() || '0',
            },
        });

        // Store subscription
        const sub = await this.databaseService.subscription.create({
            data: {
                organizationId: orgId,
                stripeCustomerId,
                stripeSubscriptionId: subscription.id,
                stripePriceId: priceId,
                planName,
                status: this.mapStripeSubscriptionStatus(subscription.status),
                currentPeriodStart: new Date((subscription as any).current_period_start * 1000),
                currentPeriodEnd: new Date((subscription as any).current_period_end * 1000),
                cancelAtPeriodEnd: (subscription as any).cancel_at_period_end,
                trialStart: (subscription as any).trial_start ? new Date((subscription as any).trial_start * 1000) : undefined,
                trialEnd: (subscription as any).trial_end ? new Date((subscription as any).trial_end * 1000) : undefined,
                monthlyCredits: monthlyCredits || undefined,
                metadata: subscription.metadata as any,
            },
        });

        return { subscriptionId: sub.id };
    }

    /**
     * Grant subscription credits (with deduplication check)
     */
    async grantSubscriptionCredits(subscriptionId: string): Promise<void> {
        const subscription = await this.databaseService.subscription.findUnique({
            where: { id: subscriptionId },
            include: { organization: true },
        });

        if (!subscription) {
            throw new NotFoundException(`Subscription ${subscriptionId} not found`);
        }

        if (!subscription.monthlyCredits || subscription.monthlyCredits.lte(0)) {
            return; // No credits to grant
        }

        // Check if credits already granted for this period
        if (
            subscription.lastCreditsGrantedPeriod &&
            subscription.lastCreditsGrantedPeriod.getTime() === subscription.currentPeriodStart.getTime()
        ) {
            this.logger.log(
                `Credits already granted for subscription ${subscriptionId} in current period`,
                PaymentsService.name,
            );
            return;
        }

        // Grant credits atomically
        await this.databaseService.$transaction(async (tx) => {
            const org = await tx.organization.findUnique({
                where: { id: subscription.organizationId },
                select: { id: true, creditBalance: true, version: true },
            });

            if (!org) {
                throw new NotFoundException(`Organization ${subscription.organizationId} not found`);
            }

            const newBalance = org.creditBalance.plus(subscription.monthlyCredits!);
            const balanceBefore = org.creditBalance;
            const balanceAfter = newBalance;

            await Promise.all([
                tx.organization.update({
                    where: { id: subscription.organizationId, version: org.version },
                    data: {
                        creditBalance: newBalance,
                        version: { increment: 1 },
                    },
                }),
                tx.creditTransaction.create({
                    data: {
                        organizationId: subscription.organizationId,
                        type: 'SUBSCRIPTION',
                        status: 'COMPLETED',
                        amount: subscription.monthlyCredits!,
                        balanceBefore,
                        balanceAfter,
                        referenceType: 'subscription',
                        referenceId: subscription.id,
                        description: `Monthly credits from subscription ${subscription.planName}`,
                        processedAt: new Date(),
                    },
                }),
                tx.subscription.update({
                    where: { id: subscriptionId },
                    data: {
                        lastCreditsGrantedPeriod: subscription.currentPeriodStart,
                    },
                }),
            ]);
        });

        this.logger.log(
            `Subscription credits granted: ${subscription.monthlyCredits!.toString()} to org ${subscription.organizationId}`,
            PaymentsService.name,
        );
    }

    /**
     * Handle subscription updated
     */
    private async handleSubscriptionUpdated(subscription: Stripe.Subscription): Promise<void> {
        const sub = await this.databaseService.subscription.findUnique({
            where: { stripeSubscriptionId: subscription.id },
        });

        if (!sub) {
            this.logger.warn(`Subscription not found for Stripe subscription ${subscription.id}`, PaymentsService.name);
            return;
        }

        await this.databaseService.subscription.update({
            where: { id: sub.id },
            data: {
                status: this.mapStripeSubscriptionStatus(subscription.status),
                currentPeriodStart: new Date((subscription as any).current_period_start * 1000),
                currentPeriodEnd: new Date((subscription as any).current_period_end * 1000),
                cancelAtPeriodEnd: subscription.cancel_at_period_end,
                canceledAt: subscription.canceled_at ? new Date(subscription.canceled_at * 1000) : undefined,
                metadata: subscription.metadata as any,
            },
        });

        // Grant credits if period changed (new billing period)
        if (sub.currentPeriodStart.getTime() !== (subscription as any).current_period_start * 1000) {
            await this.grantSubscriptionCredits(sub.id);
        }
    }

    /**
     * Handle subscription deleted
     */
    private async handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
        const sub = await this.databaseService.subscription.findUnique({
            where: { stripeSubscriptionId: subscription.id },
        });

        if (!sub) {
            return;
        }

        await this.databaseService.subscription.update({
            where: { id: sub.id },
            data: {
                status: 'CANCELLED',
                canceledAt: new Date(),
            },
        });
    }

    /**
     * Handle invoice paid (for subscription renewals)
     */
    private async handleInvoicePaid(invoice: Stripe.Invoice): Promise<void> {
        if (!(invoice as any).subscription) {
            return; // Not a subscription invoice
        }

        const subscription = await this.databaseService.subscription.findUnique({
            where: { stripeSubscriptionId: (invoice as any).subscription as string },
        });

        if (subscription && this.stripe) {
            // Fetch updated subscription from Stripe
            const stripeSubscription = await this.stripe.subscriptions.retrieve((invoice as any).subscription as string);
            // Update subscription period and grant credits
            await this.handleSubscriptionUpdated(stripeSubscription);
        }
    }

    /**
     * Cancel subscription
     */
    async cancelSubscription(subscriptionId: string, cancelAtPeriodEnd: boolean = true): Promise<void> {
        const subscription = await this.databaseService.subscription.findUnique({
            where: { id: subscriptionId },
        });

        if (!subscription) {
            throw new NotFoundException(`Subscription ${subscriptionId} not found`);
        }

        // Skip Stripe API call in development
        if (shouldMockPayments()) {
            this.logger.log(`[DEV] Skipping subscription cancellation for ${subscriptionId}`, PaymentsService.name);
            await this.databaseService.subscription.update({
                where: { id: subscriptionId },
                data: {
                    status: 'CANCELLED',
                    cancelAtPeriodEnd: false,
                    canceledAt: new Date(),
                },
            });
            return;
        }

        if (!this.stripe) {
            throw new BadRequestException('Stripe is not configured');
        }

        await this.stripe.subscriptions.update(subscription.stripeSubscriptionId, {
            cancel_at_period_end: cancelAtPeriodEnd,
        });

        await this.databaseService.subscription.update({
            where: { id: subscriptionId },
            data: {
                cancelAtPeriodEnd,
                canceledAt: cancelAtPeriodEnd ? undefined : new Date(),
            },
        });
    }

    /**
     * Refund payment
     */
    async refundPayment(paymentId: string, amount?: Decimal): Promise<void> {
        const payment = await this.databaseService.payment.findUnique({
            where: { id: paymentId },
            include: { organization: true },
        });

        if (!payment) {
            throw new NotFoundException(`Payment ${paymentId} not found`);
        }

        if (payment.status !== 'SUCCEEDED') {
            throw new BadRequestException('Can only refund succeeded payments');
        }

        const refundAmount = amount || payment.amount;

        // Skip Stripe API call in development
        if (shouldMockPayments()) {
            this.logger.log(
                `[DEV] Skipping payment refund for ${paymentId}, amount: ${refundAmount.toString()}`,
                PaymentsService.name,
            );

            await this.databaseService.$transaction(async (tx) => {
                // Update payment
                await tx.payment.update({
                    where: { id: paymentId },
                    data: {
                        status: 'REFUNDED',
                        refundedAt: new Date(),
                        refundAmount,
                    },
                });

                // Deduct credits (reverse the purchase)
                const org = await tx.organization.findUnique({
                    where: { id: payment.organizationId },
                    select: { id: true, creditBalance: true, version: true },
                });

                if (org) {
                    const creditsToRefund = refundAmount.div(payment.amount).times(payment.creditsAmount);
                    const newBalance = Decimal.max(org.creditBalance.minus(creditsToRefund), new Decimal(0));
                    const balanceBefore = org.creditBalance;
                    const balanceAfter = newBalance;

                    await Promise.all([
                        tx.organization.update({
                            where: { id: payment.organizationId, version: org.version },
                            data: {
                                creditBalance: newBalance,
                                version: { increment: 1 },
                            },
                        }),
                        tx.creditTransaction.create({
                            data: {
                                organizationId: payment.organizationId,
                                type: 'REFUND',
                                status: 'COMPLETED',
                                amount: creditsToRefund.negated(),
                                balanceBefore,
                                balanceAfter,
                                refundedPaymentId: payment.id,
                                referenceType: 'payment',
                                referenceId: payment.id,
                                description: `Refund for payment ${payment.id}`,
                                processedAt: new Date(),
                            },
                        }),
                    ]);
                }
            });

            return;
        }

        if (!this.stripe || !payment.stripeChargeId) {
            throw new BadRequestException('Stripe is not configured or payment has no charge ID');
        }

        // Create refund in Stripe
        const refund = await this.stripe.refunds.create({
            charge: payment.stripeChargeId,
            amount: Math.round(refundAmount.times(100).toNumber()),
        });

        // Process refund in database
        await this.processRefund(payment, refundAmount);
    }

    /**
     * Process refund
     */
    private async processRefund(payment: any, refundAmount: Decimal): Promise<void> {
        await this.databaseService.$transaction(async (tx) => {
            // Update payment
            await tx.payment.update({
                where: { id: payment.id },
                data: {
                    status: 'REFUNDED',
                    refundedAt: new Date(),
                    refundAmount,
                },
            });

            // Deduct credits proportionally
            const org = await tx.organization.findUnique({
                where: { id: payment.organizationId },
                select: { id: true, creditBalance: true, version: true },
            });

            if (org) {
                const creditsToRefund = refundAmount.div(payment.amount).times(payment.creditsAmount);
                const newBalance = Decimal.max(org.creditBalance.minus(creditsToRefund), new Decimal(0));
                const balanceBefore = org.creditBalance;
                const balanceAfter = newBalance;

                await Promise.all([
                    tx.organization.update({
                        where: { id: payment.organizationId, version: org.version },
                        data: {
                            creditBalance: newBalance,
                            version: { increment: 1 },
                        },
                    }),
                    tx.creditTransaction.create({
                        data: {
                            organizationId: payment.organizationId,
                            type: 'REFUND',
                            status: 'COMPLETED',
                            amount: creditsToRefund.negated(),
                            balanceBefore,
                            balanceAfter,
                            refundedPaymentId: payment.id,
                            referenceType: 'payment',
                            referenceId: payment.id,
                            description: `Refund for payment ${payment.id}`,
                            processedAt: new Date(),
                        },
                    }),
                ]);
            }
        });
    }

    /**
     * Map Stripe subscription status to our enum
     */
    private mapStripeSubscriptionStatus(status: Stripe.Subscription.Status): SubscriptionStatus {
        switch (status) {
            case 'active':
                return SubscriptionStatus.ACTIVE;
            case 'canceled':
                return SubscriptionStatus.CANCELLED;
            case 'past_due':
                return SubscriptionStatus.PAST_DUE;
            case 'unpaid':
                return SubscriptionStatus.UNPAID;
            case 'trialing':
                return SubscriptionStatus.TRIALING;
            default:
                return SubscriptionStatus.ACTIVE;
        }
    }
}
