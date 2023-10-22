import fs from 'fs';
import path from 'path';

const sourceDirectory = './data/to-filter';
const outputFile = './data/to-download/twilio-setter-calls.json'; // The path to the output JSON file

// Initialize an empty array to hold the extracted data
let extractedData = [];

// Read all files in the source directory
fs.readdir(sourceDirectory, (err, files) => {
    if (err) {
        return console.error(`Failed to read directory: ${err}`);
    }

    // Iterate over each file
    files.forEach((file) => {
        if (path.extname(file) === '.json') {
            // Only process JSON files
            const filePath = path.join(sourceDirectory, file);
            const fileContent = fs.readFileSync(filePath, 'utf8');

            try {
                const jsonData = JSON.parse(fileContent);
                if (jsonData && Array.isArray(jsonData)) {
                    jsonData.forEach((obj) => {
                        if (obj.duration) {
                            // Only add the object if CallDuration is greater than 60
                            let callDuration = parseInt(obj.duration);
                            if (callDuration > 60) {
                                // Extract the required properties
                                extractedData.push({
                                    CallDuration: obj.duration,
                                    CallSid: obj.sid,
                                    Timestamp: obj.startTime,
                                });
                            }
                        }
                    });
                }
            } catch (error) {
                console.error(
                    `Failed to parse JSON from file: ${filePath}. Error: ${error}`
                );
            }
        }
    });

    // Write the extracted data to the output file
    fs.writeFileSync(
        outputFile,
        JSON.stringify(extractedData, null, 2),
        'utf8'
    );

    console.log(`Extraction complete. Output written to ${outputFile}`);
});
