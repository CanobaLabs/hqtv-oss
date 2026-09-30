import pino from 'pino';
import { createWriteStream } from 'pino-logflare';

const logger = pino({
    level: 'info'
}, pino.multistream([
    // Log to Logflare
    {
        stream: createWriteStream({
            apiKey: '4f35bee5cef640ba4910a90e2461f5c5aee017c3d177c641464eb40e7e37c3fe',
            sourceToken: 'a25c853a-e837-47a7-8d43-2d8f0b7278f7',
        })
    },
    // Also log to console (stdout)
    {
        stream: process.stdout
    }
]));

export default logger;
