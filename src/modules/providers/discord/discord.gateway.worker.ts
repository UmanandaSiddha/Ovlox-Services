import { Client, GatewayIntentBits } from 'discord.js';
import { ExternalProvider, RawEventType } from 'generated/prisma/enums';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from 'src/services/database/database.service';

const configService = new ConfigService();
const databaseService = new DatabaseService(configService);

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

client.on('messageCreate', async message => {
    if (message.author.bot) return;

    const connections = await databaseService.integrationConnection.findMany({
        where: {
            integration: { type: ExternalProvider.DISCORD },
            items: { path: ['channels'], array_contains: message.channelId }
        }
    });

    for (const conn of connections) {
        await databaseService.rawEvent.create({
            data: {
                sourceId: conn.id,
                project: {
                    connect: { id: conn.projectId }
                },
                integration: {
                    connect: { id: conn.integrationId }
                },
                source: ExternalProvider.DISCORD,
                eventType: RawEventType.MESSAGE,
                content: message.content,
                authorName: message.author.username,
                timestamp: message.createdAt,
                metadata: message
            }
        });
    }
});

client.login(process.env.DISCORD_BOT_TOKEN);