require('dotenv').config(); // Load environment variables from .env

const { Telegraf, Markup } = require('telegraf');

const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN) {
    console.error('Error: BOT_TOKEN not found in .env file. Please create a .env with BOT_TOKEN=YOUR_TOKEN');
    process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// Simple /start command with a single button
bot.start(async (ctx) => {
    const firstName = ctx.from.first_name || 'there';
    console.log('Sending /start response with button...');
    await ctx.reply(`Hello ${firstName}! This is a local test. Do you see a button below?`,
        Markup.inlineKeyboard([
            Markup.button.callback('YES, I SEE THE BUTTON!', 'local_test_button')
        ])
    );
    console.log('Reply sent.');
});

// Handler for the local test button
bot.action('local_test_button', async (ctx) => {
    await ctx.answerCbQuery('Great! The button works locally.');
    await ctx.editMessageText('You clicked the button! Local test successful.');
});

console.log('Starting bot in long polling mode...');
bot.launch().then(() => {
    console.log('Bot started. Send /start to your bot on Telegram.');
}).catch(err => {
    console.error('Failed to launch bot:', err);
});

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));