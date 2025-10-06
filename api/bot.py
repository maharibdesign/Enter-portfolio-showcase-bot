import os
import logging
import json
from dotenv import load_dotenv
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    ApplicationBuilder, CommandHandler, CallbackQueryHandler, MessageHandler, filters
)
from fastapi import FastAPI, Request
import uvicorn

# Import Supabase helper functions from your lib folder
from lib.supabase import (
    is_user_registered, register_user, get_registered_user_count,
    get_registered_users_list, log_admin_action
)

# Load environment variables for local development
load_dotenv()

# --- Environment Variables ---
BOT_TOKEN = os.environ.get("BOT_TOKEN")
ADMIN_ID = int(os.environ.get("ADMIN_ID")) if os.environ.get("ADMIN_ID") else None
ADMIN_USERNAME = os.environ.get("ADMIN_USERNAME") # Optional

# Basic error checking for critical variables
if not BOT_TOKEN:
    logging.error("BOT_TOKEN not found. Bot cannot start.")
    exit(1) # In a serverless context, this exits the current invocation

if ADMIN_ID is None:
    logging.warning("ADMIN_ID not set. Admin commands will not function correctly.")

# --- Bot Setup ---
# Configure logging
logging.basicConfig(
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s', level=logging.INFO
)
logger = logging.getLogger(__name__)

# Create the Telegram Application
application = ApplicationBuilder().token(BOT_TOKEN).build()

# --- Middleware for Admin Check ---
async def is_admin(update: Update, context):
    if update.effective_user.id == ADMIN_ID:
        return True
    await update.message.reply_text("Unauthorized access. This command is for admins only.")
    return False

# --- /start Command ---
async def start_command(update: Update, context):
    user = update.effective_user
    telegram_id = user.id
    username = user.username
    first_name = user.first_name

    logger.info(f"[START COMMAND] User {telegram_id} ({username or 'N/A'}) initiated /start.")

    try:
        registered = await is_user_registered(telegram_id)

        if registered is None:
            logger.error(f"[START COMMAND] Supabase error during is_user_registered for user {telegram_id}.")
            await update.message.reply_text("Something went wrong, please try again later.")
            return

        if registered:
            logger.info(f"[START COMMAND] User {telegram_id} already registered.")
            await update.message.reply_text("You’re already registered. I’ll notify you when the app is live.")
        else:
            # User is NOT registered, prompt for confirmation
            registration_prompt = (
                f"Hello {first_name or 'there'}! I see you're not yet registered.\n\n"
                "I'll collect the following information to keep you updated:\n"
                f"• Your Telegram ID: `{telegram_id}`\n"
                f"• Your Username: `@{username}`\n" if username else "• Your Username: `Not available` (You can set one in Telegram settings!)\n"
                f"• Your First Name: `{first_name or 'Not provided'}`\n\n"
                "Would you like to register for updates about the Portfolio Showcase app?"
            )

            keyboard_buttons = [
                [
                    InlineKeyboardButton("✅ Yes, register me!", callback_data=f"register_yes:{telegram_id}"),
                    InlineKeyboardButton("❌ No, thanks.", callback_data="register_no")
                ]
            ]

            if ADMIN_USERNAME:
                keyboard_buttons.append([
                    InlineKeyboardButton("❓ Contact Admin", url=f"https://t.me/{ADMIN_USERNAME}")
                ])

            reply_markup = InlineKeyboardMarkup(keyboard_buttons)
            logger.info(f"[START COMMAND] Sending registration prompt with buttons to {telegram_id}.")
            await update.message.reply_text(
                registration_prompt,
                reply_markup=reply_markup,
                parse_mode='Markdown'
            )

    except Exception as e:
        logger.exception("[START COMMAND] Unhandled error in /start command.")
        await update.message.reply_text("Something went wrong, please try again later.")

# --- Callback Query Handler for Registration Buttons ---
async def registration_callback(update: Update, context):
    query = update.callback_query
    await query.answer() # Acknowledge the callback query

    callback_data = query.data
    action = callback_data.split(':')[0]
    telegram_id_from_callback = int(callback_data.split(':')[1]) if ':' in callback_data else None
    current_telegram_id = query.from_user.id
    first_name = query.from_user.first_name or 'there'

    logger.info(f"[CALLBACK ACTION] User {current_telegram_id} clicked {action}.")

    # Security check: ensure the button click is from the user who initiated it
    if telegram_id_from_callback and telegram_id_from_callback != current_telegram_id:
        await query.edit_message_text("This registration prompt is not for you.")
        return

    try:
        if action == 'register_yes':
            username = query.from_user.username
            
            already_registered = await is_user_registered(current_telegram_id)
            if already_registered is None:
                logger.error(f"[CALLBACK ACTION] Supabase error during is_user_registered for action 'yes'.")
                await query.edit_message_text("Something went wrong, please try again later.")
                return
            if already_registered:
                logger.info(f"[CALLBACK ACTION] User {current_telegram_id} already registered, clicked 'yes'.")
                await query.edit_message_text(
                    "You’re already registered. I’ll notify you when the app is live.",
                    parse_mode='Markdown'
                )
                return

            user_data = {
                "telegram_id": current_telegram_id,
                "username": username,
                "first_name": query.from_user.first_name or 'N/A'
            }

            registration_result = await register_user(user_data)

            if registration_result:
                logger.info(f"[CALLBACK ACTION] User {current_telegram_id} successfully registered.")
                await query.edit_message_text(
                    f"🎉 Great! Thanks for registering, {first_name}! I’ll notify you when the Portfolio Showcase app is ready.",
                    parse_mode='Markdown'
                )
            else:
                logger.error(f"[CALLBACK ACTION] Failed to register user {current_telegram_id}.")
                await query.edit_message_text(
                    "Something went wrong during registration, please try again later.",
                    parse_mode='Markdown'
                )
        elif action == 'register_no':
            logger.info(f"[CALLBACK ACTION] User {current_telegram_id} clicked 'no'.")
            await query.edit_message_text(
                "No problem! You can type /start again anytime if you change your mind.",
                parse_mode='Markdown'
            )
    except Exception as e:
        logger.exception("[CALLBACK ACTION] Unhandled error in registration action.")
        await query.edit_message_text("Something went wrong, please try again later.")

# --- /help Command ---
async def help_command(update: Update, context):
    user_id = update.effective_user.id
    logger.info(f"[HELP COMMAND] User {user_id} initiated /help.")

    message = "Welcome to the Portfolio Showcase Bot!\n\n"
    message += "Use /start to register for updates on the upcoming Portfolio Showcase Mini App.\n"

    if user_id == ADMIN_ID:
        message += "\n--- Admin Commands ---\n"
        message += "/count - Get the total number of registered users.\n"
        message += "/list - Get a list of all registered usernames and IDs.\n"
        message += "/notify <message> - Send a broadcast message to all registered users. Example: `/notify The app is live!`\n"

    await update.message.reply_text(message)

# --- Admin Commands ---
async def count_command(update: Update, context):
    if not await is_admin(update, context): return
    admin_id = update.effective_user.id
    logger.info(f"[ADMIN COMMAND] Admin {admin_id} initiated /count.")

    try:
        count = await get_registered_user_count()
        if count is None:
            logger.error("[ADMIN COMMAND] Supabase error during get_registered_user_count.")
            await update.message.reply_text("Something went wrong while fetching user count, please try again later.")
            await log_admin_action({"admin_telegram_id": admin_id, "action": "count_users_failed", "details": "Database error fetching count."})
            return

        await update.message.reply_text(f"Currently, {count} users are registered.")
        await log_admin_action({"admin_telegram_id": admin_id, "action": "count_users", "details": f"Returned count: {count}"})

    except Exception as e:
        logger.exception("[ADMIN COMMAND] Unhandled error in /count command.")
        await update.message.reply_text("Something went wrong, please try again later.")
        await log_admin_action({"admin_telegram_id": admin_id, "action": "count_users_failed", "details": f"Unhandled error: {str(e)}"})

async def list_command(update: Update, context):
    if not await is_admin(update, context): return
    admin_id = update.effective_user.id
    logger.info(f"[ADMIN COMMAND] Admin {admin_id} initiated /list.")

    try:
        users = await get_registered_users_list()
        if users is None:
            logger.error("[ADMIN COMMAND] Supabase error during get_registered_users_list.")
            await update.message.reply_text("Something went wrong while fetching the user list, please try again later.")
            await log_admin_action({"admin_telegram_id": admin_id, "action": "list_users_failed", "details": "Database error fetching list."})
            return

        if not users:
            logger.info("[ADMIN COMMAND] No registered users found for /list.")
            await update.message.reply_text("No users are currently registered.")
            await log_admin_action({"admin_telegram_id": admin_id, "action": "list_users", "details": "No registered users."})
            return

        user_list = "\n".join([
            f"- `{user['telegram_id']}`" + (f" (@{user['username']})" if user.get('username') else "")
            for user in users
        ])
        await update.message.reply_text(f"Registered Users:\n{user_list}", parse_mode='Markdown')
        await log_admin_action({"admin_telegram_id": admin_id, "action": "list_users", "details": f"Returned {len(users)} users."})

    except Exception as e:
        logger.exception("[ADMIN COMMAND] Unhandled error in /list command.")
        await update.message.reply_text("Something went wrong, please try again later.")
        await log_admin_action({"admin_telegram_id": admin_id, "action": "list_users_failed", "details": f"Unhandled error: {str(e)}"})

async def notify_command(update: Update, context):
    if not await is_admin(update, context): return
    admin_id = update.effective_user.id
    logger.info(f"[ADMIN COMMAND] Admin {admin_id} initiated /notify.")

    message_text = " ".join(context.args)
    if not message_text:
        logger.warning("[ADMIN COMMAND] Notify command used without message text.")
        await update.message.reply_text("Please provide a message to send. Example: `/notify The app is now live!`", parse_mode='Markdown')
        await log_admin_action({"admin_telegram_id": admin_id, "action": "notify_failed", "details": "No message text provided."})
        return

    try:
        users = await get_registered_users_list()
        if users is None:
            logger.error("[ADMIN COMMAND] Supabase error during get_registered_users_list for /notify.")
            await update.message.reply_text("Something went wrong while fetching the user list for notification, please try again later.")
            await log_admin_action({"admin_telegram_id": admin_id, "action": "notify_failed", "details": "Database error fetching user list for broadcast."})
            return

        if not users:
            logger.info("[ADMIN COMMAND] No registered users to notify.")
            await update.message.reply_text("No users are currently registered to notify.")
            await log_admin_action({"admin_telegram_id": admin_id, "action": "notify_attempt_no_users", "details": "No registered users to send broadcast to."})
            return

        successful_sends = 0
        failed_sends = 0
        failed_user_ids = []

        for user in users:
            try:
                await context.bot.send_message(chat_id=user['telegram_id'], text=message_text)
                successful_sends += 1
            except Exception as send_error:
                logger.warning(f"[ADMIN COMMAND] Failed to send message to user {user['telegram_id']} ({user.get('username', 'N/A')}): {send_error}")
                failed_sends += 1
                failed_user_ids.append(str(user['telegram_id']))

        await update.message.reply_text(f"Broadcast complete! Sent to {successful_sends} users. Failed for {failed_sends} users.")
        await log_admin_action({
            "admin_telegram_id": admin_id,
            "action": "broadcast_message",
            "details": f"Message: \"{message_text}\" | Sent: {successful_sends}, Failed: {failed_sends} (IDs: {', '.join(failed_user_ids) or 'N/A'})"
        })

    except Exception as e:
        logger.exception("[ADMIN COMMAND] Unhandled error in /notify command.")
        await update.message.reply_text("Something went wrong during the broadcast, please try again later.")
        await log_admin_action({"admin_telegram_id": admin_id, "action": "notify_failed", "details": f"Unhandled error during broadcast: {str(e)}"})

# --- Generic Message Handler ---
async def generic_message_handler(update: Update, context):
    if update.message and update.message.text and not update.message.text.startswith('/'):
        logger.info(f"[MESSAGE HANDLER] User {update.effective_user.id} sent non-command message: '{update.message.text}'.")
        await update.message.reply_text("I'm a registration bot! Please use commands like /start or /help.")

# --- Register Handlers ---
application.add_handler(CommandHandler("start", start_command))
application.add_handler(CommandHandler("help", help_command))
application.add_handler(CommandHandler("count", count_command))
application.add_handler(CommandHandler("list", list_command))
application.add_handler(CommandHandler("notify", notify_command))
application.add_handler(CallbackQueryHandler(registration_callback, pattern=r'register_(yes|no):\d+'))
application.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, generic_message_handler))

# --- Vercel Serverless Function Export ---
# FastAPI app to handle Vercel's HTTP requests
app = FastAPI()

@app.post("/api/bot")
async def webhook_handler(request: Request):
    logger.info(f"[WEBHOOK] Received request: Method={request.method}, URL={request.url}")
    if request.method == "POST":
        # Get the update from the request body
        body = await request.json()
        update = Update.de_json(body, application.bot)
        logger.info("[WEBHOOK] Processing Telegram update...")

        # Process the update
        await application.process_update(update)
        logger.info("[WEBHOOK] Telegram update processed.")
        return {"status": "ok"}
    else:
        logger.info("[WEBHOOK] Non-POST request received. Responding with info.")
        return {"message": "This is the Telegram Bot webhook endpoint. Please send POST requests with Telegram updates."}

# This is for local testing with Uvicorn
# To run locally: uvicorn api.bot:app --reload --port 8000
if __name__ == "__main__":
    logger.info("Bot started in local polling mode (for direct testing). This block will NOT run on Vercel.")
    # For local long-polling, you would normally run:
    # application.run_polling()
    # For local webhook testing (if using FastAPI as a local server), you would run uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)