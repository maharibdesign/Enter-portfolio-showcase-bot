require('dotenv').config(); // Load environment variables from .env file (for local testing)

const { Telegraf, Markup } = require('telegraf'); // Markup MUST be imported here
const {
    isUserRegistered,
    registerUser,
    getRegisteredUserCount,
    getRegisteredUsersList,
    logAdminAction
} = require('../lib/supabase'); // Import Supabase helper functions

// Environment variables
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID; // Stored as string, convert to number for comparison
const ADMIN_USERNAME = process.env.ADMIN_USERNAME; // Optional: your Telegram username (e.g., 'yourusername') for direct contact link

// Check for BOT_TOKEN
if (!BOT_TOKEN) {
    console.error('Error: BOT_TOKEN not found in environment variables. Bot cannot start.');
}

const bot = new Telegraf(BOT_TOKEN);

// --- Middleware for Admin Check ---
const isAdmin = (ctx, next) => {
    if (ctx.from && ctx.from.id === parseInt(ADMIN_ID, 10)) {
        return next();
    }
    ctx.reply('Unauthorized access. This command is for admins only.');
};

// --- /start Command ---
bot.start(async (ctx) => {
    const telegramId = ctx.from.id;
    const username = ctx.from.username;
    const firstName = ctx.from.first_name || 'there'; // Fallback for firstName

    try {
        console.log(`[START COMMAND] User ${telegramId} (${username || 'N/A'}) initiated /start.`); // Debug log
        const registered = await isUserRegistered(telegramId);

        if (registered === null) {
            console.error('[START COMMAND] Supabase error during isUserRegistered.'); // Debug log
            return ctx.reply("Something went wrong, please try again later.");
        }

        if (registered) {
            console.log(`[START COMMAND] User ${telegramId} already registered.`); // Debug log
            ctx.reply("You’re already registered. I’ll notify you when the app is live.");
        } else {
            // User is NOT registered, prompt for confirmation
            let registrationPrompt = `Hello ${firstName}! I see you're not yet registered.\n\n`; // Used fallback firstName
            registrationPrompt += `I'll collect the following information to keep you updated:\n`;
            registrationPrompt += `• Your Telegram ID: \`${telegramId}\`\n`;
            if (username) {
                registrationPrompt += `• Your Username: \`@${username}\`\n`;
            } else {
                registrationPrompt += `• Your Username: \`Not available\` (You can set one in Telegram settings!)\n`;
            }
            registrationPrompt += `• Your First Name: \`${ctx.from.first_name || 'Not provided'}\`\n\n`; // Use raw first_name here for display
            registrationPrompt += `Would you like to register for updates about the Portfolio Showcase app?`;

            // Define the buttons
            const buttons = [
                [ // First row of buttons
                    Markup.button.callback('✅ Yes, register me!', `register_yes:${telegramId}`),
                    Markup.button.callback('❌ No, thanks.', 'register_no')
                ]
            ];

            // Add 'Contact Admin' button only if ADMIN_USERNAME is set
            if (ADMIN_USERNAME) {
                buttons.push([ // Second row for 'Contact Admin'
                    Markup.button.url('❓ Contact Admin', `https://t.me/${ADMIN_USERNAME}`)
                ]);
            }

            console.log(`[START COMMAND] Sending registration prompt with buttons to ${telegramId}.`); // Debug log
            // Send the message with the inline keyboard
            await ctx.reply(registrationPrompt, {
                parse_mode: 'Markdown',
                reply_markup: Markup.inlineKeyboard(buttons)
            });
            console.log(`[START COMMAND] ctx.reply call completed for user ${telegramId}.`); // New debug log
        }
    } catch (error) {
        console.error('[START COMMAND] Unhandled error in /start command:', error);
        ctx.reply("Something went wrong, please try again later.");
    }
});

// --- Callback Query Handler for Registration Buttons ---
bot.action(/register_(yes|no):?(\d+)?/, async (ctx) => {
    const action = ctx.match[1]; // 'yes' or 'no'
    const telegramIdFromCallback = ctx.match[2] ? parseInt(ctx.match[2], 10) : null;
    const currentTelegramId = ctx.from.id; // The ID of the user who clicked the button
    const firstName = ctx.from.first_name || 'there';

    console.log(`[CALLBACK ACTION] User ${currentTelegramId} clicked ${action}.`); // Debug log

    if (telegramIdFromCallback && telegramIdFromCallback !== currentTelegramId) {
        await ctx.answerCbQuery('This registration prompt is not for you.', { show_alert: true });
        return;
    }

    await ctx.answerCbQuery();

    try {
        if (action === 'yes') {
            const username = ctx.from.username;

            const alreadyRegistered = await isUserRegistered(currentTelegramId);
            if (alreadyRegistered === null) {
                console.error('[CALLBACK ACTION] Supabase error during isUserRegistered for action "yes".');
                await ctx.editMessageText("Something went wrong, please try again later.");
                return;
            }
            if (alreadyRegistered) {
                console.log(`[CALLBACK ACTION] User ${currentTelegramId} already registered, clicked "yes".`);
                await ctx.editMessageText(
                    "You’re already registered. I’ll notify you when the app is live.",
                    { parse_mode: 'Markdown' }
                );
                return;
            }

            const userData = {
                telegram_id: currentTelegramId,
                username: username,
                first_name: ctx.from.first_name || 'N/A'
            };

            const registrationResult = await registerUser(userData);

            if (registrationResult) {
                console.log(`[CALLBACK ACTION] User ${currentTelegramId} successfully registered.`);
                await ctx.editMessageText(
                    `🎉 Great! Thanks for registering, ${firstName}! I’ll notify you when the Portfolio Showcase app is ready.`,
                    { parse_mode: 'Markdown' }
                );
            } else {
                console.error(`[CALLBACK ACTION] Failed to register user ${currentTelegramId}.`);
                await ctx.editMessageText(
                    "Something went wrong during registration, please try again later.",
                    { parse_mode: 'Markdown' }
                );
            }
        } else if (action === 'no') {
            console.log(`[CALLBACK ACTION] User ${currentTelegramId} clicked "no".`);
            await ctx.editMessageText(
                "No problem! You can type /start again anytime if you change your mind.",
                { parse_mode: 'Markdown' }
            );
        }
    } catch (error) {
        console.error('[CALLBACK ACTION] Unhandled error in registration action:', error);
        ctx.reply("Something went wrong, please try again later.");
    }
});


// --- /help Command ---
bot.help(async (ctx) => {
    console.log(`[HELP COMMAND] User ${ctx.from.id} initiated /help.`);
    const adminId = parseInt(ADMIN_ID, 10);
    const userId = ctx.from.id;

    let message = "Welcome to the Portfolio Showcase Bot!\n\n";
    message += "Use /start to register for updates on the upcoming Portfolio Showcase Mini App.\n";

    if (userId === adminId) {
        message += "\n--- Admin Commands ---\n";
        message += "/count - Get the total number of registered users.\n";
        message += "/list - Get a list of all registered usernames and IDs.\n";
        message += "/notify <message> - Send a broadcast message to all registered users. Example: `/notify The app is live!`\n";
    }

    ctx.reply(message);
});

// --- Admin Commands ---

// /count command
bot.command('count', isAdmin, async (ctx) => {
    console.log(`[ADMIN COMMAND] Admin ${ctx.from.id} initiated /count.`);
    try {
        const count = await getRegisteredUserCount();

        if (count === null) {
            console.error('[ADMIN COMMAND] Supabase error during getRegisteredUserCount.');
            await ctx.reply("Something went wrong while fetching user count, please try again later.");
            await logAdminAction({
                admin_telegram_id: ctx.from.id,
                action: 'count_users_failed',
                details: 'Database error fetching count.'
            });
            return;
        }

        await ctx.reply(`Currently, ${count} users are registered.`);
        await logAdminAction({
            admin_telegram_id: ctx.from.id,
            action: 'count_users',
            details: `Returned count: ${count}`
        });

    } catch (error) {
        console.error('[ADMIN COMMAND] Unhandled error in /count command:', error);
        ctx.reply("Something went wrong, please try again later.");
        await logAdminAction({
            admin_telegram_id: ctx.from.id,
            action: 'count_users_failed',
            details: `Unhandled error: ${error.message}`
        });
    }
});

// /list command
bot.command('list', isAdmin, async (ctx) => {
    console.log(`[ADMIN COMMAND] Admin ${ctx.from.id} initiated /list.`);
    try {
        const users = await getRegisteredUsersList();

        if (users === null) {
            console.error('[ADMIN COMMAND] Supabase error during getRegisteredUsersList.');
            await ctx.reply("Something went wrong while fetching the user list, please try again later.");
            await logAdminAction({
                admin_telegram_id: ctx.from.id,
                action: 'list_users_failed',
                details: 'Database error fetching list.'
            });
            return;
        }

        if (users.length === 0) {
            console.log('[ADMIN COMMAND] No registered users found for /list.');
            await ctx.reply("No users are currently registered.");
            await logAdminAction({
                admin_telegram_id: ctx.from.id,
                action: 'list_users',
                details: 'No registered users.'
            });
            return;
        }

        const userList = users.map(user => {
            const usernamePart = user.username ? ` (@${user.username})` : '';
            return `- ${user.telegram_id}${usernamePart}`;
        }).join('\n');

        console.log(`[ADMIN COMMAND] Returned ${users.length} users for /list.`);
        await ctx.reply(`Registered Users:\n${userList}`, { parse_mode: 'Markdown' });
        await logAdminAction({
            admin_telegram_id: ctx.from.id,
            action: 'list_users',
            details: `Returned ${users.length} users.`
        });

    } catch (error) {
        console.error('[ADMIN COMMAND] Unhandled error in /list command:', error);
        ctx.reply("Something went wrong, please try again later.");
        await logAdminAction({
            admin_telegram_id: ctx.from.id,
            action: 'list_users_failed',
            details: `Unhandled error: ${error.message}`
        });
    }
});

// /notify <message> command
bot.command('notify', isAdmin, async (ctx) => {
    console.log(`[ADMIN COMMAND] Admin ${ctx.from.id} initiated /notify.`);
    const messageText = ctx.message.text.substring('/notify '.length).trim();

    if (!messageText) {
        console.warn('[ADMIN COMMAND] Notify command used without message text.');
        await ctx.reply("Please provide a message to send. Example: `/notify The app is now live!`", { parse_mode: 'Markdown' });
        await logAdminAction({
            admin_telegram_id: ctx.from.id,
            action: 'notify_failed',
            details: 'No message text provided.'
        });
        return;
    }

    try {
        const users = await getRegisteredUsersList();

        if (users === null) {
            console.error('[ADMIN COMMAND] Supabase error during getRegisteredUsersList for /notify.');
            await ctx.reply("Something went wrong while fetching the user list for notification, please try again later.");
            await logAdminAction({
                admin_telegram_id: ctx.from.id,
                action: 'notify_failed',
                details: 'Database error fetching user list for broadcast.'
            });
            return;
        }

        if (users.length === 0) {
            console.log('[ADMIN COMMAND] No registered users to notify.');
            await ctx.reply("No users are currently registered to notify.");
            await logAdminAction({
                admin_telegram_id: ctx.from.id,
                action: 'notify_attempt_no_users',
                details: 'No registered users to send broadcast to.'
            });
            return;
        }

        let successfulSends = 0;
        let failedSends = 0;
        const failedUserIds = [];

        for (const user of users) {
            try {
                await new Promise(resolve => setTimeout(resolve, 50));
                await bot.telegram.sendMessage(user.telegram_id, messageText);
                successfulSends++;
            } catch (sendError) {
                console.warn(`[ADMIN COMMAND] Failed to send message to user ${user.telegram_id} (${user.username || 'N/A'}): ${sendError.message}`);
                failedSends++;
                failedUserIds.push(user.telegram_id);
            }
        }

        console.log(`[ADMIN COMMAND] Broadcast complete: Sent to ${successfulSends}, failed for ${failedSends}.`);
        await ctx.reply(`Broadcast complete! Sent to ${successfulSends} users. Failed for ${failedSends} users.`);
        await logAdminAction({
            admin_telegram_id: ctx.from.id,
            action: 'broadcast_message',
            details: `Message: "${messageText}" | Sent: ${successfulSends}, Failed: ${failedSends} (IDs: ${failedUserIds.join(', ') || 'N/A'})`
        });

    } catch (error) {
        console.error('[ADMIN COMMAND] Unhandled error in /notify command:', error);
        ctx.reply("Something went wrong during the broadcast, please try again later.");
        await logAdminAction({
            admin_telegram_id: ctx.from.id,
            action: 'notify_failed',
            details: `Unhandled error during broadcast: ${error.message}`
        });
    }
});

// Generic error handler for Telegraf (optional, but good practice)
bot.catch((err, ctx) => {
    console.error(`[Telegraf CATCH] Error for ${ctx.updateType}:`, err);
});

// Handle non-command messages (e.g., plain text replies).
bot.on('message', async (ctx) => {
    if (ctx.message && ctx.message.text && !ctx.message.text.startsWith('/')) {
        console.log(`[MESSAGE HANDLER] User ${ctx.from.id} sent non-command message: "${ctx.message.text}".`);
        ctx.reply("I'm a registration bot! Please use commands like /start or /help.");
    }
});


// --- Vercel Serverless Function Export (REVISED for robust response) ---
// This explicit function will ensure we always send a 200 OK response
// and can log the actual incoming request.
module.exports = async (req, res) => {
    console.log(`[WEBHOOK] Received request: Method=${req.method}, URL=${req.url}`);

    try {
        if (req.method === 'POST' && req.body) {
            console.log('[WEBHOOK] Processing Telegram update...');
            // Process the update with Telegraf. Telegraf handles sending responses.
            await bot.handleUpdate(req.body);
            console.log('[WEBHOOK] Telegraf handleUpdate completed.');
            // After Telegraf processes the update, we manually send a 200 OK
            // if Telegraf itself hasn't already sent a response (e.g., via ctx.reply).
            if (!res.headersSent) {
                res.statusCode = 200;
                res.setHeader('Content-Type', 'text/plain');
                res.end('OK'); // Acknowledge the webhook
                console.log('[WEBHOOK] Manual 200 OK sent after Telegraf processing.');
            }
        } else {
            console.log('[WEBHOOK] Non-POST request received. Responding with info.');
            res.statusCode = 200;
            res.setHeader('Content-Type', 'text/plain');
            res.end('This is the Telegram Bot webhook endpoint. Please send POST requests with Telegram updates.');
        }
    } catch (err) {
        console.error('[WEBHOOK ERROR] Error handling update:', err);
        // Ensure an error response is sent for failed processing
        if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: false, error: err.message || 'Internal Server Error' }));
            console.error('[WEBHOOK ERROR] Sent 500 error response.');
        }
    }
};

// --- Local Development (Optional, for testing without Vercel) ---
// This block will NOT run on Vercel because Vercel only executes the module.exports function.
/*
if (process.env.NODE_ENV === 'development' && !process.env.VERCEL) {
    bot.launch();
    console.log('Bot started in long polling mode (local development)');
    // Enable graceful stop
    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
}
*/