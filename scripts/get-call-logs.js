import fs from 'fs/promises';
import twilio from 'twilio';
import dotenv from 'dotenv';
dotenv.config();

// SET ENV VARIABLES
const accountSid = process.env.TWILIO_ACCOUNT_SID_GHL; // Main AccountSID
const authToken = process.env.TWILIO_AUTH_TOKEN_GHL;

const accountSidClosers = process.env.TWILIO_ACCOUNT_SID_GHL_CLOSERS; // Air.ai subaccount AccountSID
const authTokenClosers = process.env.TWILIO_AUTH_TOKEN_GHL_CLOSERS;

const accountSidSetters = process.env.TWILIO_ACCOUNT_SID_GHL_SETTERS; // setter AccountSID
const authTokenSetters = process.env.TWILIO_AUTH_TOKEN_GHL_SETTERS;

// SET THE TWILIO CLIENT
const client = twilio(accountSidSetters, authTokenSetters);

async function getTwilioSubaccountNames() {
    client.api.v2010
        .accounts(accountSidClosers)
        .fetch()
        .then((account) => console.log(account.friendlyName));
}

// await getTwilioSubaccountNames();

async function getTwilioCallLogs() {
    const calls = await client.calls.list();

    // Write data to a JSON file
    await fs.writeFile(
        './callLogsSetters.json',
        JSON.stringify(calls, null, 2),
        (err) => {
            if (err) {
                console.error('An error occurred while writing file: ', err);
            } else {
                console.log(
                    'Call log data successfully written to callLogs.json'
                );
            }
        }
    );

    // calls.forEach((call) => {});
}

await getTwilioCallLogs();
