// import fs from 'fs';
// import dotenv from 'dotenv';
// import Closeio from 'close.io';
// dotenv.config();

// const closeio = new Closeio(process.env.CLOSE_API_KEY);

// async function getCallLogs() {
//     try {
//         const calls = await closeio.activity.call.search();
//         fs.writeFileSync(
//             './data/to-filter/closeLogs.json',
//             JSON.stringify(calls, null, 2)
//         );

//         // Handle the search results as needed.
//     } catch (err) {
//         console.log('There has been an error.', err);
//     }
// }

// getCallLogs();

import fs from 'fs';
import dotenv from 'dotenv';
import Closeio from 'close.io';
dotenv.config();

const closeio = new Closeio(process.env.CLOSE_API_KEY);

async function getCallLogs() {
    let offset = 0;
    let hasMore = true;
    let retries = 0;
    const maxRetries = 5;

    const writeStream = fs.createWriteStream('./data/to-filter/closeLogs.json');
    writeStream.write('['); // Start of array

    while (hasMore) {
        try {
            const response = await closeio.activity.call.search({
                skip: offset,
            });

            // Transform data to string
            const dataStr = response.data
                .map((call) => JSON.stringify(call))
                .join(',');

            // If it's not the first page of results, we prepend a comma
            if (offset > 0) {
                writeStream.write(',');
            }
            writeStream.write(dataStr);

            hasMore = response.has_more;

            if (hasMore) {
                offset += response.data.length;
            }

            // reset retries count on successful request
            retries = 0;
        } catch (err) {
            if (retries === maxRetries) {
                console.log(`Failed to fetch after ${maxRetries} attempts.`);
                throw err;
            }

            console.log('There has been an error. Retrying...', err);

            // Exponential backoff
            const delay = Math.min(2 ** retries * 1000, 60000);
            await new Promise((resolve) => setTimeout(resolve, delay));

            retries++;
        }
    }

    writeStream.write(']'); // End of array
    writeStream.end();
}

getCallLogs();
