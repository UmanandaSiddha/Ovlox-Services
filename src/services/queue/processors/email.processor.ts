import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { EMAIL_QUEUE } from 'src/config/constants';
import { EmailJobPayload } from '../email.queue';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from 'src/services/logger/logger.service';
import { SESClient, SendEmailCommand, SendTemplatedEmailCommand } from '@aws-sdk/client-ses';
import { shouldSkipPayments } from 'src/utils/environment.util';

@Injectable()
@Processor(EMAIL_QUEUE)
export class EmailProcessor extends WorkerHost {
    private readonly logger = new LoggerService(EmailProcessor.name);
    private readonly sesClient: SESClient;
    private readonly fromEmail: string;
    private readonly region: string;

    constructor(private readonly configService: ConfigService) {
        super();

        const accessKeyId = this.configService.get<string>('AWS_ACCESS_KEY_ID');
        const secretAccessKey = this.configService.get<string>('AWS_SECRET_ACCESS_KEY');
        this.region = this.configService.get<string>('AWS_REGION') || 'us-east-1';
        this.fromEmail = this.configService.get<string>('AWS_SES_FROM_EMAIL') || 'noreply@example.com';

        if (!accessKeyId || !secretAccessKey) {
            this.logger.warn('AWS SES credentials not configured. Email operations will fail.', EmailProcessor.name);
        }

        this.sesClient = new SESClient({
            region: this.region,
            credentials: accessKeyId && secretAccessKey ? {
                accessKeyId,
                secretAccessKey,
            } : undefined,
        });
    }

    async process(job) {
        const data = job.data as EmailJobPayload;

        this.logger.log(`Sending email to ${data.to}`, EmailProcessor.name);

        if (shouldSkipPayments()) {
            // In development, log but don't send
            this.logger.log(`[DEV] Email would be sent to ${data.to}: ${data.subject}`, EmailProcessor.name);
            console.log('[DEV] Email:', data);
            return true;
        }

        try {
            // If template is provided, use SendTemplatedEmailCommand
            if (data.template) {
                const command = new SendTemplatedEmailCommand({
                    Source: this.fromEmail,
                    Destination: {
                        ToAddresses: [data.to],
                    },
                    Template: data.template,
                    TemplateData: JSON.stringify(data.data || {}),
                });

                await this.sesClient.send(command);
                this.logger.log(`Templated email sent to ${data.to} using template ${data.template}`, EmailProcessor.name);
            } else {
                // Send plain email
                const command = new SendEmailCommand({
                    Source: this.fromEmail,
                    Destination: {
                        ToAddresses: [data.to],
                    },
                    Message: {
                        Subject: {
                            Data: data.subject || 'Notification',
                            Charset: 'UTF-8',
                        },
                        Body: {
                            Html: {
                                Data: this.renderEmailTemplate(data.template || 'default', data.data),
                                Charset: 'UTF-8',
                            },
                            Text: {
                                Data: this.renderEmailText(data.template || 'default', data.data),
                                Charset: 'UTF-8',
                            },
                        },
                    },
                });

                await this.sesClient.send(command);
                this.logger.log(`Email sent to ${data.to}: ${data.subject}`, EmailProcessor.name);
            }

            return true;
        } catch (error) {
            this.logger.error(`Failed to send email to ${data.to}: ${error.message}`, EmailProcessor.name);
            throw error;
        }
    }

    /**
     * Render email HTML template
     */
    private renderEmailTemplate(template: string, data: any): string {
        // Basic template rendering - can be expanded with a templating engine
        if (template === 'invite') {
            return `
                <html>
                    <body>
                        <h2>You've been invited to join an organization!</h2>
                        <p>${data.message || 'Please accept the invitation to get started.'}</p>
                        <a href="${data.inviteUrl}">Accept Invitation</a>
                    </body>
                </html>
            `;
        }

        if (template === 'welcome') {
            return `
                <html>
                    <body>
                        <h2>Welcome to Ovlox!</h2>
                        <p>${data.message || 'Thank you for joining.'}</p>
                    </body>
                </html>
            `;
        }

        // Default template
        return `
            <html>
                <body>
                    <p>${data.message || data.content || 'You have a new notification.'}</p>
                </body>
            </html>
        `;
    }

    /**
     * Render email text content
     */
    private renderEmailText(template: string, data: any): string {
        if (template === 'invite') {
            return `${data.message || 'You have been invited to join an organization. Please visit:'} ${data.inviteUrl}`;
        }

        if (template === 'welcome') {
            return data.message || 'Welcome to Ovlox!';
        }

        return data.message || data.content || 'You have a new notification.';
    }

    @OnWorkerEvent('failed')
    onFailed(job, err) {
        this.logger.error(`Email job failed: ${job.id} - ${err}`, EmailProcessor.name);
    }
}