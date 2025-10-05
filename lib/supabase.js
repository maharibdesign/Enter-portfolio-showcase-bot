require('dotenv').config(); // Load environment variables from .env file (for local testing)

const { createClient } = require('@supabase/supabase-js');

// Environment variables for Supabase connection
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

// Check if environment variables are loaded
if (!supabaseUrl || !supabaseKey) {
  console.error('Error: Supabase URL or Key not found in environment variables. Ensure .env or Vercel config is set.');
  // In a real production scenario, you might want to throw an error or exit.
  // For Vercel, this error will appear in logs but won't stop the function.
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Helper function to log errors
const logError = (context, error) => {
    console.error(`[Supabase Error - ${context}]:`, error.message);
    if (error.details) console.error('Details:', error.details);
    if (error.hint) console.error('Hint:', error.hint);
};

// --- User Registration Functions ---

/**
 * Checks if a user is already registered.
 * @param {number} telegramId - The Telegram user ID.
 * @returns {Promise<boolean|null>} True if registered, false if not, null on error.
 */
async function isUserRegistered(telegramId) {
    try {
        const { data, error } = await supabase
            .from('registrations')
            .select('telegram_id')
            .eq('telegram_id', telegramId)
            .single();

        if (error && error.code !== 'PGRST116') { // PGRST116 means no rows found (expected for new users)
            logError('isUserRegistered', error);
            return null; // Indicate an actual error
        }
        return !!data; // Returns true if data exists (user registered), false otherwise
    } catch (e) {
        logError('isUserRegistered (catch)', e);
        return null;
    }
}

/**
 * Registers a new user.
 * @param {object} userData - Object containing telegram_id, username, first_name.
 * @returns {Promise<object|null>} The inserted user data on success, null on error.
 */
async function registerUser(userData) {
    try {
        const { data, error } = await supabase
            .from('registrations')
            .insert({
                telegram_id: userData.telegram_id,
                username: userData.username,
                first_name: userData.first_name
            })
            .select() // Return the inserted data
            .single();

        if (error) {
            logError('registerUser', error);
            return null;
        }
        return data;
    } catch (e) {
        logError('registerUser (catch)', e);
        return null;
    }
}

// --- Admin Functions ---

/**
 * Gets the total number of registered users.
 * @returns {Promise<number|null>} The count of users on success, null on error.
 */
async function getRegisteredUserCount() {
    try {
        const { count, error } = await supabase
            .from('registrations')
            .select('*', { count: 'exact', head: true }); // head: true for performance, only count

        if (error) {
            logError('getRegisteredUserCount', error);
            return null;
        }
        return count;
    } catch (e) {
        logError('getRegisteredUserCount (catch)', e);
        return null;
    }
}

/**
 * Gets a list of all registered usernames and IDs.
 * @returns {Promise<Array<object>|null>} An array of user objects on success, null on error.
 */
async function getRegisteredUsersList() {
    try {
        const { data, error } = await supabase
            .from('registrations')
            .select('telegram_id, username');

        if (error) {
            logError('getRegisteredUsersList', error);
            return null;
        }
        return data;
    } catch (e) {
        logError('getRegisteredUsersList (catch)', e);
        return null;
    }
}

// --- Admin Logging Function ---

/**
 * Logs an admin action.
 * @param {object} logData - Object containing admin_telegram_id, action, details.
 * @returns {Promise<object|null>} The inserted log data on success, null on error.
 */
async function logAdminAction(logData) {
    try {
        const { data, error } = await supabase
            .from('admin_logs')
            .insert({
                admin_telegram_id: logData.admin_telegram_id,
                action: logData.action,
                details: logData.details
            })
            .select() // Return the inserted data
            .single();

        if (error) {
            logError('logAdminAction', error);
            return null;
        }
        return data;
    } catch (e) {
        logError('logAdminAction (catch)', e);
        return null;
    }
}


module.exports = {
    isUserRegistered,
    registerUser,
    getRegisteredUserCount,
    getRegisteredUsersList,
    logAdminAction,
    supabase // Export supabase client if needed elsewhere, though functions are usually preferred
};