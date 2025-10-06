require('dotenv').config(); // Load environment variables from .env file (for local testing)

const { Telegraf, Markup } = require('telegraf'); // Markup is correctly imported
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
const ADMIN_USERNAME = process.env.ADMIN_USERNAME; // Not used in this version, but kept for future

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

// --- /start Command (with Dummy Button Test) ---
bot.start(async (ctx) => {
    const telegramId = ctx.from.id;
    const firstName = ctx.from.first_name || 'there';

    try {
        const registered = await isUserRegistered(telegramId);

        if (registered === null) {
            return ctx.reply("Something went wrong, please try again later.");
        }

        if (registered) {
            ctx.reply("You’re already registered. I’ll notify you when the app is live.");
        } else {
            // User is NOT registered, send the diagnostic test message
            const registrationPrompt = `Hello ${firstName}! This is a diagnostic test to solve the button issue.\n\nPlease click the single button below to register.`;

            // --- DUMMY BUTTON TEST ---
            // We are using the simplest possible inline keyboard to isolate the problem.
            await ctx.reply(registrationPrompt, {
                parse_mode: 'Markdown',
                reply_markup: Markup.inlineKeyboard([
                    Markup.button.callback('Click Here to Register', 'confirm_registration')
                ])
            });
        }
    } catch (error) {
        console.error('Error in /start command:', error);
        ctx.reply("Something went wrong, please try again later.");
    }
});

// --- DUMMY BUTTON ACTION HANDLER ---
// This handler ONLY listens for the 'confirm_registration' callback from our test button.
bot.action('confirm_registration', async (ctx) => {
    // Acknowledge the button click to stop the loading spinner
    await ctx.answerCbQuery('Processing registration...');

    const telegramId = ctx.from.id;
    const firstName = ctx.from.first_name || 'there';
    const username = ctx.from.username;

    try {
        // Double-check if the user is already registered (in case of a double-click)
        const alreadyRegistered = await isUserRegistered(telegramId);
        if (alreadyRegistered) {
            await ctx.editMessageText("You are already registered. Thanks!");
            return;
        }

        // Register the user
        const userData = {
            telegram_id: telegramId,
            username: username,
            first_name: ctx.from.first_name || 'N/A'
        };
        const registrationResult = await registerUser(userData);

        if (registrationResult) {
            await ctx.editMessageText(`✅ Test Successful! Thanks for registering, ${firstName}! You will be notified when the app is ready.`);
        } else {
            await ctx.editMessageText("❌ Registration Failed. Something went wrong. Please try /start again.");
        }
    } catch (error) {
        console.error('Error in dummy button action handler:', error);
        await ctx.editMessageText("An error occurred during registration. Please try again.");
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
// (The admin commands remain unchanged)

// /count command
bot.command('count', isAdmin, async (ctx) => {
    try {
        const count = await getRegisteredUserCount();
        if (count === null) {
            await ctx.reply("Something went wrong while fetching user count.");
        } else {
            await ctx.reply(`Currently, ${count} users are registered.`);
        }
        await logAdminAction({ admin_telegram_id: ctx.from.id, action: 'count_users', details: `Count: ${count}` });
    } catch (error) {
        console.error('Error in /count command:', error);
        ctx.reply("An error occurred.");
    }
});

// /list command
bot.command('list', isAdmin, async (ctx) => {
    try {
        const users = await getRegisteredUsersList();
        if (users === null) {
            await ctx.reply("Something went wrong while fetching the user list.");
        } else if (users.length === 0) {
            await ctx.reply("No users are currently registered.");
        } else {
            const userList = users.map(user => `- ${user.telegram_id}${user.username ? ` (@${user.username})` : ''}`).join('\n');
            await ctx.reply(`Registered Users:\n${userList}`, { parse_mode: 'Markdown' });
        }
        await logAdminAction({ admin_telegram_id: ctx.from.id, action: 'list_users', details: `Returned ${users ? users.length : 0} users.` });
    } catch (error) {
        console.error('Error in /list command:', error);
        ctx.reply("An error occurred.");
    }
});

// /notify <message> command
bot.command('notify', isAdmin, async (ctx) => {
    const messageText = ctx.message.text.substring('/notify '.length).trim();
    if (!messageText) {
        return ctx.reply("Please provide a message. Example: `/notify The app is live!`");
    }
    try {
        const users = await getRegisteredUsersList();
        if (!users || users.length === 0) {
            return ctx.reply("No users registered to notify.");
        }
        let successfulSends = 0;
        let failedSends = 0;
        for (const user of users) {
            try {
                await bot.telegram.sendMessage(user.telegram_id, messageText);
                successfulSends++;
            } catch (sendError) {
                console.warn(`Failed to send to user ${user.telegram_id}: ${sendError.message}`);
                failedSends++;
            }
        }
        await ctx.reply(`Broadcast complete! Sent to ${successfulSends} users. Failed for ${failedSends} users.`);
        await logAdminAction({ admin_telegram_id: ctx.from.id, action: 'broadcast_message', details: `Message: "${messageText}" | Sent: ${successfulSends}, Failed: ${failedSends}` });
    } catch (error) {
        console.error('Error in /notify command:', error);
        ctx.reply("An error occurred during the broadcast.");
    }
});

// --- Generic Handlers ---

bot.catch((err, ctx) => {
    console.error(`[Telegraf Error] for ${ctx.updateType}`, err);
});

bot.on('message', async (ctx) => {
    if (!ctx.message.text.startsWith('/')) {
        ctx.reply("I'm a registration bot! Please use commands like /start or /help.");
    }
});

// --- Vercel Serverless Function Export ---
module.exports = async (req, res) => {
    try {
        if (req.method === 'POST' && req.body) {
            await bot.handleUpdate(req.body);
        } else {
            res.setHeader('Content-Type', 'text/plain');
            res.end('Telegram Bot Webhook Endpoint.');
        }
    } catch (err) {
        console.error('Error handling update:', err);
    } finally {
        if (!res.headersSent) {
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: true }));
        }
    }
};