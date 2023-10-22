import fetch from 'node-fetch';
import fs from 'fs/promises';
import { createObjectCsvWriter as createCsvWriter } from 'csv-writer';
import dotenv from 'dotenv';
dotenv.config();

const apiKey = process.env.CLOSE_API_KEY;
const dateStart = '2020-01-01';
const dateEnd = '2023-07-20';
const filePath = './AUDIO/close.io';

const getRecordedCalls = async (day) => {
    let hasMore = true;
    let skip = 0;
    const calls = [];

    while (hasMore) {
        const res = await fetch(
            `https://api.close.com/api/v1/activity/call?_skip=${skip}&date_created__gte=${day.startDate}&date_created__lte=${day.endDate}&_fields=id,recording_url,voicemail_url,date_created,lead_id,duration,voicemail_duration`,
            {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${apiKey}`,
                },
            }
        );

        const json = await res.json();
        console.log(json);

        json.data.forEach((call) => {
            if (
                (call.duration > 0 || call.voicemail_duration > 0) &&
                (call.recording_url || call.voicemail_url)
            ) {
                call.url = call.recording_url || call.voicemail_url;
                if (call.duration > 0) {
                    call.type = 'Answered Call';
                    call.durationFinal = call.duration;
                } else {
                    call.type = 'Voicemail';
                    call.durationFinal = call.voicemail_duration;
                }
                calls.push(call);
            }
        });

        skip += json.data.length;
        hasMore = json.has_more;
    }

    return calls;
};

const downloadCall = async (call) => {
    const res = await fetch(call.url, {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
        },
    });

    const buffer = await res.buffer();

    await fs.writeFile(`${filePath}/close-recording-${call.id}.mp3`, buffer);

    return {
        'Call Activity ID': call.id,
        'Date Created': call.date_created,
        Type: call.type,
        Duration: call.durationFinal,
        'Lead ID': call.lead_id,
        Filename: `close-recording-${call.id}.mp3`,
        url: call.url,
    };
};

const main = async () => {
    const startDate = new Date(dateStart);
    const endDate = new Date(dateEnd);
    const days = [];

    while (startDate <= endDate) {
        const dayStart = new Date(startDate).toISOString();
        startDate.setDate(startDate.getDate() + 1);
        const dayEnd = new Date(startDate).toISOString();

        days.push({
            day: dayStart.split('T')[0],
            startDate: dayStart,
            endDate: dayEnd,
        });
    }

    const allCalls = [];
    for (const day of days) {
        const calls = await getRecordedCalls(day);
        allCalls.push(...calls);
    }

    const allCallsSorted = allCalls.sort(
        (a, b) => new Date(b.date_created) - new Date(a.date_created)
    );

    const downloadedCalls = [];
    for (const call of allCallsSorted) {
        const downloadedCall = await downloadCall(call);
        downloadedCalls.push(downloadedCall);
    }

    const csvWriter = createCsvWriter({
        path: `${filePath}/Downloaded Call Recordings from ${dateStart} to ${dateEnd} Reference.csv`,
        header: [
            { id: 'Call Activity ID', title: 'Call Activity ID' },
            { id: 'Date Created', title: 'Date Created' },
            { id: 'Type', title: 'Type' },
            { id: 'Duration', title: 'Duration' },
            { id: 'Lead ID', title: 'Lead ID' },
            { id: 'Filename', title: 'Filename' },
            { id: 'url', title: 'URL' },
        ],
    });

    await csvWriter.writeRecords(downloadedCalls);
};

main();
