import {
    Controller,
    Post,
    Get,
    Body,
    Param,
    UseGuards,
    Query,
    Req,
    RawBodyRequest,
    Headers,
    BadRequestException,
} from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { AuthGuard, getUser } from '../auth/guards/auth.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { RequirePermission } from '../auth/decorator/permission.decorator';
import { PermissionName } from 'generated/prisma/enums';
import { CreatePaymentIntentDto } from './dto/create-payment-intent.dto';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { RefundPaymentDto } from './dto/refund-payment.dto';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import Decimal from 'decimal.js';
import { shouldSkipPayments } from 'src/utils/environment.util';
import { DatabaseService } from 'src/services/database/database.service';
import { Public } from '../auth/decorator/public.decorator';

@Controller('orgs/:orgId/payments')
@UseGuards(AuthGuard, PermissionGuard)
export class PaymentsController {
    private stripe: Stripe | null = null;

    constructor(
        private readonly paymentsService: PaymentsService,
        private readonly configService: ConfigService,
        private readonly databaseService: DatabaseService,
    ) {
        if (!shouldSkipPayments()) {
            const stripeKey = this.configService.get<string>('STRIPE_SECRET_KEY');
            if (stripeKey) {
                this.stripe = new Stripe(stripeKey, { apiVersion: '2025-12-15.clover' as any });
            }
        }
    }

    @Post('create-intent')
    @RequirePermission(PermissionName.MANAGE_ORG)
    async createPaymentIntent(
        @Param('orgId') orgId: string,
        @Body() dto: CreatePaymentIntentDto,
    ) {
        const amount = new Decimal(dto.amount);
        const creditsAmount = new Decimal(dto.creditsAmount);
        const currency = dto.currency || 'usd';

        const result = await this.paymentsService.createPaymentIntent(orgId, amount, currency, creditsAmount);

        return {
            clientSecret: result.clientSecret,
            paymentIntentId: result.paymentIntentId,
        };
    }

    @Get()
    @RequirePermission(PermissionName.MANAGE_ORG)
    async listPayments(
        @Param('orgId') orgId: string,
        @Query('limit') limit?: string,
        @Query('offset') offset?: string,
    ) {
        const payments = await this.databaseService.payment.findMany({
            where: { organizationId: orgId },
            orderBy: { createdAt: 'desc' },
            take: limit ? parseInt(limit) : 50,
            skip: offset ? parseInt(offset) : 0,
            include: {
                creditTransactions: true,
            },
        });

        return payments;
    }

    @Get(':id')
    @RequirePermission(PermissionName.MANAGE_ORG)
    async getPayment(@Param('orgId') orgId: string, @Param('id') id: string) {
        const payment = await this.databaseService.payment.findFirst({
            where: { id, organizationId: orgId },
            include: {
                creditTransactions: true,
                refundTransactions: true,
            },
        });

        if (!payment) {
            throw new BadRequestException('Payment not found');
        }

        return payment;
    }

    @Post(':id/refund')
    @RequirePermission(PermissionName.MANAGE_ORG)
    async refundPayment(
        @Param('orgId') orgId: string,
        @Param('id') id: string,
        @Body() dto: RefundPaymentDto,
    ) {
        const refundAmount = dto.amount ? new Decimal(dto.amount) : undefined;
        await this.paymentsService.refundPayment(id, refundAmount);

        return { message: 'Payment refunded successfully' };
    }

    @Post('subscriptions/create')
    @RequirePermission(PermissionName.MANAGE_ORG)
    async createSubscription(@Param('orgId') orgId: string, @Body() dto: CreateSubscriptionDto) {
        const monthlyCredits = dto.monthlyCredits ? new Decimal(dto.monthlyCredits) : undefined;
        const result = await this.paymentsService.createSubscription(orgId, dto.priceId, dto.planName, monthlyCredits);

        return result;
    }

    @Get('subscriptions')
    @RequirePermission(PermissionName.MANAGE_ORG)
    async listSubscriptions(@Param('orgId') orgId: string) {
        const subscriptions = await this.databaseService.subscription.findMany({
            where: { organizationId: orgId },
            orderBy: { createdAt: 'desc' },
            include: {
                stripeCustomer: true,
            },
        });

        return subscriptions;
    }

    @Post('subscriptions/:id/cancel')
    @RequirePermission(PermissionName.MANAGE_ORG)
    async cancelSubscription(
        @Param('orgId') orgId: string,
        @Param('id') id: string,
        @Body() body: { cancelAtPeriodEnd?: boolean },
    ) {
        await this.paymentsService.cancelSubscription(id, body.cancelAtPeriodEnd ?? true);

        return { message: 'Subscription cancelled successfully' };
    }

    @Get('credits/balance')
    @RequirePermission(PermissionName.MANAGE_ORG)
    async getCreditBalance(@Param('orgId') orgId: string) {
        const org = await this.databaseService.organization.findUnique({
            where: { id: orgId },
            select: {
                creditBalance: true,
                creditLimit: true,
            },
        });

        if (!org) {
            throw new BadRequestException('Organization not found');
        }

        return {
            creditBalance: org.creditBalance.toString(),
            creditLimit: org.creditLimit?.toString() || null,
            availableCredits: org.creditLimit
                ? Decimal.min(org.creditBalance, org.creditLimit).toString()
                : org.creditBalance.toString(),
        };
    }

    @Get('credits/transactions')
    @RequirePermission(PermissionName.MANAGE_ORG)
    async getCreditTransactions(
        @Param('orgId') orgId: string,
        @Query('limit') limit?: string,
        @Query('offset') offset?: string,
        @Query('type') type?: string,
    ) {
        const transactions = await this.databaseService.creditTransaction.findMany({
            where: {
                organizationId: orgId,
                ...(type ? { type: type as any } : {}),
            },
            orderBy: { createdAt: 'desc' },
            take: limit ? parseInt(limit) : 50,
            skip: offset ? parseInt(offset) : 0,
            include: {
                payment: true,
                llmUsage: true,
            },
        });

        return transactions;
    }
}

@Controller('payments')
@Public()
export class PaymentsWebhookController {
    private stripe: Stripe | null = null;

    constructor(
        private readonly paymentsService: PaymentsService,
        private readonly configService: ConfigService,
    ) {
        if (!shouldSkipPayments()) {
            const stripeKey = this.configService.get<string>('STRIPE_SECRET_KEY');
            if (stripeKey) {
                this.stripe = new Stripe(stripeKey, { apiVersion: '2025-12-15.clover' as any });
            }
        }
    }

    @Post('webhook')
    async handleWebhook(
        @Req() req: RawBodyRequest<Request>,
        @Headers('stripe-signature') signature: string,
    ) {
        const webhookSecret = this.configService.get<string>('STRIPE_WEBHOOK_SECRET');

        if (shouldSkipPayments()) {
            // In development, accept any webhook payload
            const event = req.body as any;
            await this.paymentsService.handleStripeWebhook(event);
            return { received: true };
        }

        if (!this.stripe || !webhookSecret) {
            throw new BadRequestException('Stripe webhook not configured');
        }

        let event: Stripe.Event;

        try {
            const rawBody = (req as any).rawBody || JSON.stringify(req.body);
            event = this.stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
        } catch (err) {
            throw new BadRequestException(`Webhook signature verification failed: ${err.message}`);
        }

        await this.paymentsService.handleStripeWebhook(event);

        return { received: true };
    }
}
