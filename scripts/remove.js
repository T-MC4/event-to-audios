import fs from "fs";
import util from "util";

// Convert fs.readFile into Promise version to use with async/await
const readFile = util.promisify(fs.readFile);
const writeFile = util.promisify(fs.writeFile);

async function removeDuplicateCallSids() {
	try {
		const dataMain = JSON.parse(
			await readFile("./data/to-download/1min-plus-calls.json", "utf8")
		);
		const dataFile1 = JSON.parse(
			await readFile(
				"./data/JSON/dual-json/1min-plus-calls-with-paths.json",
				"utf8"
			)
		);
		const dataFile2 = JSON.parse(
			await readFile("./data/JSON/mono-json/mono-calls-with-paths.json", "utf8")
		);
		const dataFile3 = JSON.parse(
			await readFile(
				"./data/JSON/client-json/scale13ClientRecordings.json",
				"utf8"
			)
		);

		// Get CallSids from files 1, 2, 3
		const callSids1 = dataFile1.map((obj) => obj.CallSid);
		const callSids2 = dataFile2.map((obj) => obj.CallSid);
		const callSids3 = dataFile3.map((obj) => obj.CallSid);

		// Combine CallSids from all files
		const allCallSids = [...callSids1, ...callSids2, ...callSids3];

		// Filter main data to include only items that do not exist in allCallSids
		const filteredDataMain = dataMain.filter(
			(obj) => !allCallSids.includes(obj.CallSid)
		);

		// Write the filtered data back to the main.json file
		await writeFile(
			"./filtered.json",
			JSON.stringify(filteredDataMain, null, 2),
			"utf8"
		);
	} catch (err) {
		console.error(err);
	}
}

removeDuplicateCallSids();
