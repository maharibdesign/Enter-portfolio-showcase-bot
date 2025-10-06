require('dotenv').config(); // Load environment variables from .env file (for local testing)

const { Telegraf, Markup } = require('telegraf'); // <-- Make sure Markup is imported here!
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

// Check for BOT_TOKEN
if (!BOT_TOKEN) {
    console.error('Error: BOT_TOKEN not found in environment variables. Bot cannot start.');
    process.exit(1); // In a serverless function, this might just terminate the current invocation.
}

const bot = new Telegraf(BOT_TOKEN);

// --- Middleware for Admin Check ---
const isAdmin = (ctx, next) => {
    // Telegraf's ctx.from.id is a number, ADMIN_ID from env is a string, so convert ADMIN_ID
    if (ctx.from && ctx.from.id === parseInt(ADMIN_ID, 10)) {
        return next();
    }
    ctx.reply('Unauthorized access. This command is for admins only.');
};

// --- /start Command ---
bot.start(async (ctx) => {
    const telegramId = ctx.from.id;
    const username = ctx.from.username;
    const firstName = ctx.from.first_name;

    try {
        const registered = await isUserRegistered(telegramId);

        if (registered === null) {
            // Supabase error occurred
            return ctx.reply("Something went wrong, please try again later.");
        }

        if (registered) {
            ctx.reply("You’re already registered. I’ll notify you when the app is live.");
        } else {
            // User is NOT registered, prompt for confirmation
            let registrationPrompt = `Hello ${firstName || 'there'}! I see you're not yet registered.\n\n`;
            registrationPrompt += `I'll collect the following information to keep you updated:\n`;
            registrationPrompt += `• Your Telegram ID: \`${telegramId}\`\n`;
            if (username) {
                registrationPrompt += `• Your Username: \`@${username}\`\n`;
            } else {
                registrationPrompt += `• Your Username: \`Not available\` (You can set one in Telegram settings!)\n`;
            }
            registrationPrompt += `• Your First Name: \`${firstName || 'Not provided'}\`\n\n`;
            registrationPrompt += `Would you like to register for updates about the Portfolio Showcase app?`;

            await ctx.reply(registrationPrompt, {
                parse_mode: 'Markdown',
                reply_markup: Markup.inlineKeyboard([
                    Markup.button.callback('✅ Yes, register me!', `register_yes:${telegramId}`),
                    Markup.button.callback('❌ No, thanks.', 'register_no')
                ])
            });
        }
    } catch (error) {
        console.error('Error in /start command:', error);
        ctx.reply("Something went wrong, please try again later.");
    }
});

// --- Callback Query Handler for Registration Buttons ---
bot.action(/register_(yes|no):?(\d+)?/, async (ctx) => {
    const action = ctx.match[1]; // 'yes' or 'no'
    const telegramIdFromCallback = ctx.match[2] ? parseInt(ctx.match[2], 10) : null;
    const currentTelegramId = ctx.from.id; // The ID of the user who clicked the button

    // It's good practice to verify that the user clicking 'yes' is the same user who initiated /start
    // This prevents one user from registering another by clicking their button in a group, for example.
    if (telegramIdFromCallback && telegramIdFromCallback !== currentTelegramId) {
        await ctx.answerCbQuery('This registration prompt is not for you.', { show_alert: true });
        return;
    }

    // Dismiss the loading spinner on the button
    await ctx.answerCbQuery();

    try {
        if (action === 'yes') {
            const username = ctx.from.username;
            const firstName = ctx.from.first_name;

            // Double check registration status before trying to register
            const alreadyRegistered = await isUserRegistered(currentTelegramId);
            if (alreadyRegistered === null) {
                await ctx.editMessageText("Something went wrong, please try again later.");
                return;
            }
            if (alreadyRegistered) {
                await ctx.editMessageText(
                    "You’re already registered. I’ll notify you when the app is live.",
                    { parse_mode: 'Markdown' }
                );
                return;
            }

            const userData = {
                telegram_id: currentTelegramId,
                username: username,
                first_name: firstName || 'N/A'
            };

            const registrationResult = await registerUser(userData);

            if (registrationResult) {
                // Edit the original message to reflect the action
                await ctx.editMessageText(
                    `🎉 Great! Thanks for registering, ${firstName || 'there'}! I’ll notify you when the Portfolio Showcase app is ready.`,
                    { parse_mode: 'Markdown' }
                );
            } else {
                // This could happen if there's a race condition or actual DB error
                await ctx.editMessageText(
                    "Something went wrong during registration, please try again later.",
                    { parse_mode: 'Markdown' }
                );
            }
        } else if (action === 'no') {
            await ctx.editMessageText(
                "No problem! You can type /start again anytime if you change your mind.",
                { parse_mode: 'Markdown' }
            );
        }
    } catch (error) {
        console.error('Error in registration action:', error);
        await ctx.editMessageText("Something went wrong, please try again later.");
    }
});


// --- /help Command ---
bot.help(async (ctx) => {
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
    try {
        const count = await getRegisteredUserCount();

        if (count === null) {
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
        console.error('Error in /count command:', error);
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
    try {
        const users = await getRegisteredUsersList();

        if (users === null) {
            await ctx.reply("Something went wrong while fetching the user list, please try again later.");
            await logAdminAction({
                admin_telegram_id: ctx.from.id,
                action: 'list_users_failed',
                details: 'Database error fetching list.'
            });
            return;
        }

        if (users.length === 0) {
            await ctx.reply("No users are currently registered.");
            await logAdminAction({
                admin_telegram_id: ctx.from.id,
                action: 'list_users',
                details: 'No registered users.'
            });
            return;
        }

        // Format the list for display
        const userList = users.map(user => {
            const usernamePart = user.username ? ` (@${user.username})` : '';
            return `- ${user.telegram_id}${usernamePart}`;
        }).join('\n');

        await ctx.reply(`Registered Users:\n${userList}`, { parse_mode: 'Markdown' });
        await logAdminAction({
            admin_telegram_id: ctx.from.id,
            action: 'list_users',
            details: `Returned ${users.length} users.`
        });

    } catch (error) {
        console.error('Error in /list command:', error);
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
    const messageText = ctx.message.text.substring('/notify '.length).trim();

    if (!messageText) {
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
            await ctx.reply("Something went wrong while fetching the user list for notification, please try again later.");
            await logAdminAction({
                admin_telegram_id: ctx.from.id,
                action: 'notify_failed',
                details: 'Database error fetching user list for broadcast.'
            });
            return;
        }

        if (users.length === 0) {
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
                // Add a small delay to avoid hitting Telegram API rate limits if many users
                await new Promise(resolve => setTimeout(resolve, 50)); // 50ms delay
                await bot.telegram.sendMessage(user.telegram_id, messageText);
                successfulSends++;
            } catch (sendError) {
                console.warn(`Failed to send message to user ${user.telegram_id} (${user.username || 'N/A'}): ${sendError.message}`);
                failedSends++;
                failedUserIds.push(user.telegram_id);
            }
        }

        await ctx.reply(`Broadcast complete! Sent to ${successfulSends} users. Failed for ${failedSends} users.`);
        await logAdminAction({
            admin_telegram_id: ctx.from.id,
            action: 'broadcast_message',
            details: `Message: "${messageText}" | Sent: ${successfulSends}, Failed: ${failedSends} (IDs: ${failedUserIds.join(', ') || 'N/A'})`
        });

    } catch (error) {
        console.error('Error in /notify command:', error);
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
    console.error(`[Telegraf Error] for ${ctx.updateType}`, err);
    // You might want to send a generic error message to the user here
    // ctx.reply('Oops, something went wrong!');
});

// Handle non-command messages (e.g., plain text replies).
// For this bot, we mostly expect commands, so we can give a default hint.
bot.on('message', async (ctx) => {
    if (!ctx.message.text.startsWith('/')) { // Only reply if it's not a command
        ctx.reply("I'm a registration bot! Please use commands like /start or /help.");
    }
});


// --- Vercel Serverless Function Export ---
// This is crucial for running on Vercel as a webhook
module.exports = async (req, res) => {
    try {
        // Ensure the request is a POST and has a body, typical for Telegram webhooks
        if (req.method === 'POST' && req.body) {
            await bot.handleUpdate(req.body);
        } else {
            // Respond to GET requests (e.g., browser access to the webhook URL)
            // or malformed POST requests.
            console.log('Received non-webhook request:', req.method, req.url);
            res.statusCode = 200; // Still respond 200, but perhaps with a different message
            res.setHeader('Content-Type', 'text/plain');
            res.end('Telegram Bot Webhook Endpoint. Please send POST requests with Telegram updates.');
            return;
        }
    } catch (err) {
        console.error('Error handling update:', err);
    } finally {
        // Vercel expects a response, even if the bot logic is async.
        // A 200 OK status indicates the webhook was received successfully.
        if (!res.headersSent) { // Ensure headers haven't already been sent by an early return
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: true }));
        }
    }
};

// --- Local Development (Optional, for testing without Vercel) ---
// If you want to run this locally for testing without deploying to Vercel,
// you can uncomment the lines below and use bot.launch() with long polling.
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