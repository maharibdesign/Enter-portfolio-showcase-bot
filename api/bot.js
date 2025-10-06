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
    // In a serverless function, this might just terminate the current invocation.
    // For local testing, process.exit(1) is useful.
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
        const registered = await isUserRegistered(telegramId);

        if (registered === null) {
            // Supabase error occurred
            return ctx.reply("Something went wrong, please try again later.");
        }

        if (registered) {
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

            // Send the message with the inline keyboard
            await ctx.reply(registrationPrompt, {
                parse_mode: 'Markdown',
                reply_markup: Markup.inlineKeyboard(buttons)
            });
        }
    } catch (error) {
        console.error('Error in /start command:', error);
        ctx.reply("Something went wrong, please try again later.");
    }
});

// --- Callback Query Handler for Registration Buttons ---
// (No longer handles 'contact_admin' as it's a URL button)
bot.action(/register_(yes|no):?(\d+)?/, async (ctx) => {
    const action = ctx.match[1]; // 'yes' or 'no'
    const telegramIdFromCallback = ctx.match[2] ? parseInt(ctx.match[2], 10) : null;
    const currentTelegramId = ctx.from.id; // The ID of the user who clicked the button
    const firstName = ctx.from.first_name || 'there';

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
                first_name: ctx.from.first_name || 'N/A' // Use raw first_name here
            };

            const registrationResult = await registerUser(userData);

            if (registrationResult) {
                // Edit the original message to reflect the action
                await ctx.editMessageText(
                    `🎉 Great! Thanks for registering, ${firstName}! I’ll notify you when the Portfolio Showcase app is ready.`,
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
        // Fallback if editMessageText fails (e.g., message too old)
        ctx.reply("Something went wrong, please try again later.");
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


// --- Vercel Serverless Function Export (CRITICAL FIX) ---
// This is the Vercel-recommended way to integrate Telegraf as a webhook.
// The path here MUST match the 'src' in your vercel.json routes for the bot.
// In your case, that is "/api/bot".
module.exports = bot.webhookCallback('/api/bot');

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