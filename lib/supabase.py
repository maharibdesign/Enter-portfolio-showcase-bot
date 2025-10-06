import os
from supabase import create_client, Client
from dotenv import load_dotenv

# Load environment variables for local development
load_dotenv()

SUPABASE_URL: str = os.environ.get("SUPABASE_URL")
SUPABASE_KEY: str = os.environ.get("SUPABASE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("Error: Supabase URL or Key not found in environment variables. Ensure .env or Vercel config is set.")
    # In a production serverless function, this might still allow the function to run but fail on DB calls.

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

def _log_error(context: str, error_details: any):
    """Helper to log errors consistently."""
    print(f"[Supabase Error - {context}]: {error_details}")

async def is_user_registered(telegram_id: int) -> bool | None:
    """Checks if a user is already registered."""
    try:
        response = supabase.table("registrations").select("telegram_id").eq("telegram_id", telegram_id).execute()
        # The 'data' field will be an empty list if no rows are found, or a list with dicts if found
        return bool(response.data)
    except Exception as e:
        _log_error("is_user_registered", e)
        return None

async def register_user(user_data: dict) -> dict | None:
    """Registers a new user."""
    try:
        response = supabase.table("registrations").insert(user_data).execute()
        if response.data:
            return response.data[0] # Return the first inserted row
        return None
    except Exception as e:
        _log_error("register_user", e)
        return None

async def get_registered_user_count() -> int | None:
    """Gets the total number of registered users."""
    try:
        # Supabase Python client's select().count() method directly returns the count
        response = supabase.table("registrations").select("count", head=True).execute()
        return response.count
    except Exception as e:
        _log_error("get_registered_user_count", e)
        return None

async def get_registered_users_list() -> list[dict] | None:
    """Gets a list of all registered usernames and IDs."""
    try:
        response = supabase.table("registrations").select("telegram_id, username").execute()
        return response.data
    except Exception as e:
        _log_error("get_registered_users_list", e)
        return None

async def log_admin_action(log_data: dict) -> dict | None:
    """Logs an admin action."""
    try:
        response = supabase.table("admin_logs").insert(log_data).execute()
        if response.data:
            return response.data[0]
        return None
    except Exception as e:
        _log_error("log_admin_action", e)
        return None