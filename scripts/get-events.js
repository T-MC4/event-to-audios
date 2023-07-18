import fs from 'fs';
import csv from 'csv-parser';
import stream from 'stream';
import util from 'util';
const pipeline = util.promisify(stream.pipeline);

async function processCSV(inputFilePath, outputFilePath, maxRecordsPerFile) {
    let writeStream;
    let firstRow = true;
    let fileCount = 0;
    let rowCount = 0;

    const createNewWriteStream = () => {
        if (writeStream) {
            writeStream.write(']'); // End of JSON
            writeStream.end();
        }
        writeStream = fs.createWriteStream(
            outputFilePath + ++fileCount + '.json'
        );
        writeStream.write('['); // Start of JSON
        rowCount = 0;
        firstRow = true;
    };

    createNewWriteStream();

    await pipeline(
        fs.createReadStream(inputFilePath),
        csv(),
        new stream.Transform({
            objectMode: true,
            transform: (data, _, callback) => {
                // Now using 'EVENT_DETAILS'
                if (
                    data &&
                    data.hasOwnProperty('EVENT_DETAILS') &&
                    data.EVENT_DETAILS &&
                    data.EVENT_DETAILS.trim() !== ''
                ) {
                    try {
                        const row = JSON.parse(data.EVENT_DETAILS);
                        // Separate rows with a comma unless it's the first row
                        let rowString;
                        try {
                            rowString =
                                (firstRow ? '' : ',') + JSON.stringify(row);
                        } catch (error) {
                            console.error(
                                `Error stringifying row: ${data.EVENT_DETAILS}. Error: ${error}`
                            );
                        }
                        firstRow = false;
                        if (rowString) {
                            writeStream.write(rowString);
                            rowCount++;
                            if (rowCount >= maxRecordsPerFile) {
                                createNewWriteStream();
                            }
                        }
                    } catch (error) {
                        console.error(
                            `Error parsing JSON from row: ${JSON.stringify(
                                data
                            )}. Error: ${error}`
                        );
                    }
                }
                callback();
            },
        })
    );

    if (writeStream) {
        writeStream.write(']}'); // End of JSON
        writeStream.end();
    }

    console.log(`Files have been written to ${outputFilePath}`);
}

const inputFilePath = './CSV/snowflake.csv';
const outputFilePath = './to-filter/events.json';
const maxRecordsPerFile = 5000; // Adjust as necessary
processCSV(inputFilePath, outputFilePath, maxRecordsPerFile);
