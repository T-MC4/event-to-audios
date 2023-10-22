import fs from 'fs';
import path from 'path';
import pLimit from 'p-limit';
import ffmpeg from 'fluent-ffmpeg';
import twilio from 'twilio';
import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

// ---------------------------------------- //
// ---------- Twilio Client Setup --------- //
// ---------------------------------------- //
const accountSid = process.env.TWILIO_ACCOUNT_SID; // main AccountSID
const authToken = process.env.TWILIO_AUTH_TOKEN;

const accountSidClosers = process.env.TWILIO_ACCOUNT_SID_GHL_CLOSERS; // Air.ai subaccount
const authTokenClosers = process.env.TWILIO_AUTH_TOKEN_GHL_CLOSERS;

const accountSidSetters = process.env.TWILIO_ACCOUNT_SID_GHL_SETTERS; // Air.ai DIALER sub
const authTokenSetters = process.env.TWILIO_AUTH_TOKEN_GHL_SETTERS;

// const client = twilio(accountSid, authToken);
const client = twilio(accountSidSetters, authTokenSetters);
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
const dualOutputFile = `${jsonDirectory}/dual-json/twilio-setter-dual-calls.json`;
const monoOutputFile = `${jsonDirectory}/mono-json/twilio-setter-mono-calls.json`;
const scale13ClientOutputFile = `${jsonDirectory}/client-json/scale13ClientRecordings-setter-twilio.json`;

// ---------------------------------------- //
// ---------- Stream Output Setup --------- //
// ---------------------------------------- //
const rateLimiting = true; // Toggle this to enable/disable rate limiting
const limit = rateLimiting ? pLimit(5) : null; // Limit to 5 concurrent downloads

let outputStream = fs.createWriteStream(dualOutputFile, { flags: 'a' }); // Set 'a' for 'append'
let monoOutputStream = fs.createWriteStream(monoOutputFile, { flags: 'a' }); // Set 'a' for 'append'
let scale13ClientOutputStream = fs.createWriteStream(scale13ClientOutputFile, {
    flags: 'a',
}); // Set 'a' for 'append'

// Write initial opening brackets for JSON arrays
outputStream.write('[');
monoOutputStream.write('[');
scale13ClientOutputStream.write('[');

// ------------------------------------------ //
// ---------- MAIN SCRIPT EXECUTION --------- //
// ------------------------------------------ //

async function processFiles(sourceDirectory) {
    fs.readdir(sourceDirectory, async (err, files) => {
        if (err) {
            return console.error(`\nFailed to read directory: ${err}`);
        }

        let tasks = [];

        // PROCESS EACH FILE
        for (let file of files) {
            if (path.extname(file) === '.json') {
                const filePath = path.join(sourceDirectory, file);
                const fileContent = fs.readFileSync(filePath, 'utf8');

                // PROCESS EACH OBJECT
                try {
                    const jsonData = JSON.parse(fileContent);
                    for (let obj of jsonData) {
                        if (obj.CallDuration) {
                            const callDuration = parseInt(obj.CallDuration);
                            if (callDuration > 60) {
                                const task = () => processAudio(obj); // Remove async/await here

                                if (rateLimiting) {
                                    tasks.push(limit(task)); // task should be a function that returns a promise
                                } else {
                                    tasks.push(task()); // If not rate limiting, execute the task immediately
                                }
                            }
                        }
                    }
                } catch (error) {
                    console.error(
                        `\nFailed to parse JSON from file: ${filePath}. Error: ${error}`
                    );
                }
            }
        }

        // Wait for all tasks to finish
        try {
            await Promise.all(tasks);

            // Write closing bracket for JSON arrays
            outputStream.write('{}]');
            outputStream.end(); // Close the stream

            monoOutputStream.write('{}]');
            monoOutputStream.end(); // Close the stream

            scale13ClientOutputStream.write('{}]');
            scale13ClientOutputStream.end(); // Close the stream

            console.log(`\nExtraction complete. Output written`);
        } catch (error) {
            console.error(`\nFailed to execute tasks: ${error}`);
        }
    });
}
await processFiles(sourceDirectory);

// ----------------------------------------------- //
// ---------- Function Definitions Setup --------- //
// ----------------------------------------------- //

async function processAudio(obj) {
    try {
        // Before you proceed, get the recordings.
        const recordingUrls = await getTwilioRecordings(obj);

        // If the array is empty, don't proceed with the processAudio function.
        if (recordingUrls.length === 0 || recordingUrls === undefined) {
            return;
        }
        console.log(`\n🚀 processAudio: ${obj.CallSid} ->`, recordingUrls);

        let downloads = await Promise.all(
            recordingUrls.map(async (url) => {
                return await downloadAudio(url, obj.CallSid);
            })
        );

        // If the array is empty, don't proceed with the processAudio function.
        if (downloads.length === 0 || downloads === undefined) {
            return;
        }

        console.log(
            `\n🚀 processAudio - ${obj.CallSid} downloaded:`,
            downloads
        );

        for (let download of downloads) {
            const { localPath, url } = download;
            const type = await getAudioType(localPath);
            console.log(`\n🚀 processAudio: ${obj.CallSid} type ->`, type);
            let result = {
                CallDuration: obj.CallDuration,
                RecordingUrl: url, // Changed obj.RecordingUrl to url
                CallSid: obj.CallSid,
                RecordingSid: extractRecordingSid(url),
                Timestamp: obj.Timestamp,
                AudioPath: localPath,
                Type: type,
            };

            // Check if the audio type is mono or dual
            if (type === 'mono') {
                console.log(
                    '🚀 ~ file: audioDownload.js:226 ~ processAudio ~ result:',
                    result
                );
                // If it's mono, move the file to monoAudioDirectory and write the result to monoOutputStream
                const monoPath = path.join(
                    monoAudioDirectory,
                    path.basename(localPath)
                );
                result.AudioPath = monoPath;
                fs.renameSync(localPath, monoPath);
                monoOutputStream.write(JSON.stringify(result) + ',');
                return;
            } else {
                console.log(
                    '🚀 ~ file: audioDownload.js:226 ~ processAudio ~ result:',
                    result
                );
                // If it's not mono, write the result to outputStream
                outputStream.write(JSON.stringify(result) + ',');
                return;
            }
        }
    } catch (error) {
        console.error(
            `\nFailed to process audio: ${obj.CallSid} : Error: ${error}`
        );
    }
}

export async function downloadAudio(url, id) {
    console.log(`\nDOWNlOADING RECORDINGS FOR SID: ${id}`);
    let response = await callTwilio(url, id, `.wav?RequestedChannels=2`);

    // If False, try again without params
    if (!response) {
        response = await callTwilio(url, id);
    }

    // Download & save file w/ correct extension
    const ext = getExtension(response);
    return await downloadFile(url, id, ext, response, dualAudioDirectory);
    // NOTE: ALL audios are saved to dual folder, and then we filter out mono;
}

import { pipeline } from 'stream';
import { promisify } from 'util';
const pipelineAsync = promisify(pipeline);

async function downloadFile(url, id, ext, response, audioDirectory) {
    const localPath = path.join(audioDirectory, `${id}${ext}`);
    const writer = fs.createWriteStream(localPath);

    await pipelineAsync(response.data, writer);

    return { localPath, url };
}

function getExtension(response) {
    if (response.headers['content-type'] === 'audio/mpeg') {
        return '.mp3';
    } else if (
        response.headers['content-type'] === 'audio/wav' ||
        response.headers['content-type'] === 'audio/x-wav'
    ) {
        return '.wav';
    } else {
        throw new Error(
            `\nUnsupported content type: ${response.headers['content-type']}`
        );
    }
}

async function callTwilio(url, id, params) {
    try {
        let finalUrl = url;
        if (params) {
            finalUrl = url + params;
        }
        console.log(finalUrl);
        const response = await axios({
            url: finalUrl,
            method: 'GET',
            responseType: 'stream',
        });

        if (response.status === 200) {
            if (params) {
                console.log(
                    `\n🚀 downloadAudio ~ ${id} "DUAL" response:`,
                    response.status,
                    id
                );
            } else {
                console.log(
                    `\n🚀 downloadAudio ~ ${id} "MONO" response:`,
                    response.status,
                    id
                );
            }
            return response;
        } else {
            console.log(`\n Download Failed`);
            return false;
        }
    } catch (err) {
        console.log(`\nCouldn't process - params: ${params} - ERROR: ${err}`);
    }
}

export async function getTwilioRecordings(obj) {
    console.log(`\nGETTING RECORDINGS FOR SID: ${obj.CallSid}`);
    try {
        // NOTE: const HAS to be named "recordings" - Do NOT rename or twilio sdk will fail
        const recordings = await client.recordings.list({
            callSid: obj.CallSid,
            limit: 20,
        });

        if (recordings.length === 0 || recordings === undefined) {
            console.log(`\n${obj.CallSid} has no recordings`);
            // If there are no recordings, write the object to scale13ClientOutputStream and return
            scale13ClientOutputStream.write(JSON.stringify(obj) + ',');
            return [];
        }

        console.log(
            `\n🚀 getTwilioRecordings: ${obj.CallSid} -> ${recordings[0].sid}${
                recordings[1] ? ', ' + recordings[1].sid : ''
            }`
        );

        return recordings.map((recording) => recording.mediaUrl);
    } catch (error) {
        console.error(
            `\nFailed to fetch Twilio recordings for CallSid: ${obj.CallSid} : Error: ${error}`
        );
    }
}

export function extractRecordingSid(url) {
    console.log('\nProcessing url');
    // Create a new URL object
    const parsedUrl = new URL(url);

    // Split the pathname into segments and get the last non-empty one
    let recordingSid = parsedUrl.pathname.split('/').filter(Boolean).pop();

    // Remove .wav extension if it exists
    if (recordingSid.endsWith('.wav')) {
        recordingSid = recordingSid.substring(0, recordingSid.length - 4);
    }
    // Remove .mp3 extension if it exists
    if (recordingSid.endsWith('.mp3')) {
        recordingSid = recordingSid.substring(0, recordingSid.length - 4);
    }
    console.log('\n🚀 extractRecordingSid ~ recordingSid:', recordingSid);

    return recordingSid;
}

export function getAudioType(audioPath) {
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
