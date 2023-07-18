import axios from 'axios';
import fs from 'fs';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import pLimit from 'p-limit';
import twilio from 'twilio';
import dotenv from 'dotenv';
dotenv.config();

// ---------------------------------------- //
// ---------- Twilio Client Setup --------- //
// ---------------------------------------- //
const accountSid = process.env.TWILIO_ACCOUNT_SID; // Your AccountSID and Auth Token from twilio.com/console
const authToken = process.env.TWILIO_AUTH_TOKEN;

const accountSidClosers = process.env.TWILIO_ACCOUNT_SID_GHL_CLOSERS; // Air.ai subaccount AccountSID
const authTokenClosers = process.env.TWILIO_AUTH_TOKEN_GHL_CLOSERS;

const accountSidSetters = process.env.TWILIO_ACCOUNT_SID_GHL_SETTERS; // setter AccountSID
const authTokenSetters = process.env.TWILIO_AUTH_TOKEN_GHL_SETTERS;

// const client = twilio(accountSid, authToken);
const client = twilio(accountSidClosers, authTokenClosers);
// const client = twilio(accountSidSetters, authTokenSetters);

// ----------------------------------------------- //
// ---------- Audio/Json Directory Setup --------- //
// ----------------------------------------------- //
const baseDirectory = './data';
const jsonDirectory = `${baseDirectory}/JSON`;
const audioDirectory = `${baseDirectory}/AUDIO`;

// Directory where original data is located
const sourceDirectory = `${baseDirectory}/to-download`;

// Directories for different types of audio
const dualAudioDirectory = `${audioDirectory}/dual-audios`;
const monoAudioDirectory = `${audioDirectory}/mono-audios`;

// JSON output files for different data types
const dualOutputFile = `${jsonDirectory}/dual-json/twilio-closer-dual-calls.json`;
const monoOutputFile = `${jsonDirectory}/mono-json/twilio-closer-mono-calls.json`;
const scale13ClientOutputFile = `${jsonDirectory}/client-json/scale13ClientRecordings-closer-twilio.json`;

// ---------------------------------------- //
// ---------- Stream Output Setup --------- //
// ---------------------------------------- //
const rateLimiting = true; // Toggle this to enable/disable rate limiting
const limit = rateLimiting ? pLimit(20) : null; // Limit to 20 concurrent downloads

let outputStream = fs.createWriteStream(dualOutputFile, { flags: 'a' }); // Set flag to 'a' for 'append'
let monoOutputStream = fs.createWriteStream(monoOutputFile, { flags: 'a' }); // Set flag to 'a' for 'append'
let scale13ClientOutputStream = fs.createWriteStream(scale13ClientOutputFile, {
    flags: 'a',
}); // Set flag to 'a' for 'append'

// Write initial opening brackets for JSON arrays
outputStream.write('[');
monoOutputStream.write('[');
scale13ClientOutputStream.write('[');

// ----------------------------------------------- //
// ---------- Function Definitions Setup --------- //
// ----------------------------------------------- //

async function getTwilioRecordings(obj) {
    try {
        const recordings = await client.recordings.list({
            callSid: obj.CallSid,
            limit: 20,
        });
        console.log(recordings);
        if (recordings.length === 0) {
            // If there are no recordings, write the object to scale13ClientOutputStream and return
            scale13ClientOutputStream.write(JSON.stringify(obj) + ',');
            return [];
        }
        return recordings.map((recording) => recording.mediaUrl);
    } catch (error) {
        console.error(
            `Failed to fetch Twilio recordings for CallSid: ${obj.CallSid}. Error: ${error}`
        );
    }
}

async function downloadAudio(url, id) {
    let response;
    let finalUrl;
    try {
        finalUrl = url + `.wav?RequestedChannels=2`;
        console.log(finalUrl);
        response = await axios({
            url: finalUrl,
            method: 'GET',
            responseType: 'stream',
        });
    } catch (err) {
        console.log(
            `Couldn't process w/ .wav?RequestedChannels=2 params: ${err}`
        );
        finalUrl = url;
        console.log('Attempting download, but without params');
        response = await axios({
            finalUrl,
            method: 'GET',
            responseType: 'stream',
        });
    }

    let ext;
    if (response.headers['content-type'] === 'audio/mpeg') {
        ext = '.mp3';
    } else if (
        response.headers['content-type'] === 'audio/wav' ||
        response.headers['content-type'] === 'audio/x-wav'
    ) {
        ext = '.wav';
    } else {
        throw new Error(
            `Unsupported content type: ${response.headers['content-type']}`
        );
    }

    const localPath = path.join(dualAudioDirectory, `${id}${ext}`);
    const writer = fs.createWriteStream(localPath);

    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
        writer.on('finish', () => resolve({ localPath, finalUrl }));
        writer.on('error', reject);
    });
}

function extractRecordingSid(url) {
    // Create a new URL object
    const parsedUrl = new URL(url);

    // Split the pathname into segments and get the last non-empty one
    let recordingSid = parsedUrl.pathname.split('/').filter(Boolean).pop();

    // Remove .wav extension if it exists
    if (recordingSid.endsWith('.wav')) {
        recordingSid = recordingSid.substring(0, recordingSid.length - 4);
    }

    return recordingSid;
}

function getAudioType(audioPath) {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(audioPath, function (err, metadata) {
            if (err) reject(err);
            else {
                const audioStream = metadata.streams.find(
                    (stream) => stream.codec_type === 'audio'
                );
                resolve(audioStream.channels === 1 ? 'mono' : 'dual');
            }
        });
    });
}

async function processAudio(obj) {
    try {
        // Before you proceed, get the recordings.
        const recordingUrls = await getTwilioRecordings(obj);
        console.log(recordingUrls);

        // If the array is empty, don't proceed with the processAudio function.
        if (recordingUrls.length === 0) {
            return;
        }

        const downloads = await Promise.all(
            recordingUrls.map((url, index) =>
                downloadAudio(url, `${obj.CallSid}-${index}`)
            )
        );
        console.log(`Recordings for ${obj.callSid} Downloaded`);

        for (let download of downloads) {
            const { localPath, finalUrl } = download;
            const type = await getAudioType(localPath);
            console.log(type);
            let result = {
                CallDuration: obj.CallDuration,
                RecordingUrl: finalUrl, // Changed obj.RecordingUrl to finalUrl
                CallSid: obj.CallSid,
                RecordingSid: extractRecordingSid(finalUrl),
                Timestamp: obj.Timestamp,
                AudioPath: localPath,
                Type: type,
            };
            console.log(result);

            // Check if the audio type is mono or dual
            if (type === 'mono') {
                // If it's mono, move the file to monoAudioDirectory and write the result to monoOutputStream
                const monoPath = path.join(
                    monoAudioDirectory,
                    path.basename(audioPath)
                );
                result.AudioPath = monoPath;
                fs.renameSync(audioPath, monoPath);
                result.AudioPath = monoPath;
                monoOutputStream.write(JSON.stringify(result) + ',');
            } else {
                // If it's not mono, write the result to outputStream
                outputStream.write(JSON.stringify(result) + ',');
            }
        }
    } catch (error) {
        console.error(
            `Failed to process audio: ${obj.RecordingUrl}. Error: ${error}`
        );
    }
}

// ------------------------------------------ //
// ---------- MAIN SCRIPT EXECUTION --------- //
// ------------------------------------------ //

fs.readdir(sourceDirectory, async (err, files) => {
    if (err) {
        return console.error(`Failed to read directory: ${err}`);
    }

    let tasks = [];

    files.forEach((file) => {
        if (path.extname(file) === '.json') {
            const filePath = path.join(sourceDirectory, file);
            const fileContent = fs.readFileSync(filePath, 'utf8');

            try {
                const jsonData = JSON.parse(fileContent);
                jsonData.forEach((obj) => {
                    if (obj.CallDuration && obj.RecordingUrl) {
                        const callDuration = parseInt(obj.CallDuration);
                        if (callDuration > 60) {
                            const task = async () => {
                                await processAudio(obj); // Process the audio
                            };

                            if (rateLimiting) {
                                tasks.push(limit(task));
                            } else {
                                tasks.push(task());
                            }
                        }
                    }
                });
            } catch (error) {
                console.error(
                    `Failed to parse JSON from file: ${filePath}. Error: ${error}`
                );
            }
        }
    });

    // Wait for all tasks to finish
    await Promise.all(tasks);

    // Write closing bracket for JSON arrays
    outputStream.write('{}]');
    outputStream.end(); // Close the stream

    monoOutputStream.write('{}]');
    monoOutputStream.end(); // Close the stream

    scale13ClientOutputStream.write('{}]');
    scale13ClientOutputStream.end(); // Close the stream

    console.log(`Extraction complete. Output written`);
});
