import { parse } from "node-html-parser"

const ENTRY_POINT: string = "https://create.roblox.com/docs/reference/engine/enums";

interface EnumData {
    name: string,
    summary: string,
    description: string,
    codeSamples: string[],
    tags: string[],
    deprecationMessage: string,
    items: {
        name: string,
        summary: string,
        value: number,
        tags: string[],
        deprecationMessage: string
    }[]
}

/// Returns array containing URLs to Enums 
async function getAllEnums(): Promise<string[]> {
    const response = await fetch(ENTRY_POINT);
    if (!response.body) {
        throw new Error("Request failed. Returned no body");
    }
    const body = await response.body.text();
    const document = parse(body);
    const stringData = document.querySelector("#__NEXT_DATA__")?.innerText;
    if (!stringData) {
        throw new Error("Failed to get __NEXT_DATA json data")
    }
    const data = JSON.parse(stringData);

    return data.props.pageProps.data.references.Enum.map(
        (enumName: string) => `https://create.roblox.com/docs/reference/engine/enums/${enumName}`
    )
}

function rustDisplayer(enumData: EnumData): string {
    if (enumData.items.length === 0) {
        return ""
    }
    let output = "";
    if (enumData.deprecationMessage !== "") {
        output += `\n#[deprecated = ${JSON.stringify(enumData.deprecationMessage)}]`;
    }
    if (enumData.summary !== "") {
        output += enumData.summary.trim().split("\n").map(line => `\n/// ${line}`);
    }
    if (enumData.summary !== enumData.description) {
        if (enumData.description !== "") {
            output += enumData.description.trim().split("\n").map(line => `\n/// ${line}`);
        }
    }
    output += `\n#[derive(Debug, Clone, Copy, PartialEq, Eq)]`;
    output += `\n#[repr(u32)]`;
    output += `\npub enum ${enumData.name} {`
    for (const item of enumData.items) {
        if (item.deprecationMessage !== "") {
            output += `\n\t#[deprecated = "${item.deprecationMessage.trim()}"]`;
        }
        if (item.summary !== "") {
            output += item.summary.trim().split("\n").map(line => `\n\t/// ${line}`);
        }
        if (item.name === "Self") {
            item.name = "Self_";
        }
        output += `\n\t${item.name} = ${item.value},`
    }
    output = output.substring(0, output.length - 1)
    output += "\n}"

    output += `\n\nimpl PartialEq<u32> for ${enumData.name} {\n\tfn eq(&self, other: &u32) -> bool {\n\t\t*self as u32 == *other\n\t}\n}`
    output += `\n\nimpl PartialEq<${enumData.name}> for u32 {\n\tfn eq(&self, other: &${enumData.name}) -> bool {\n\t\t*self == *other as u32\n\t}\n}`
    output += `\n\nimpl TryFrom<u32> for ${enumData.name} {
    type Error = &'static str;
    fn try_from(value: u32) -> Result<Self, Self::Error> {
        match value {
${enumData.items.map(item => `\t\t\t${item.value} => Ok(Self::${item.name}),`).join("\n")}
            _ => Err("Invalid value")
        }
    }
}`

    return output;
}

/// this shit was gpted cuz i dont know fucking c++
function cppDisplayer(enumData: EnumData): string {
    if (enumData.items.length === 0) {
        return ""
    }
    let output = "";

    // Top-level documentation
    if (enumData.summary !== "") {
        output += enumData.summary.trim().split("\n").map(line => `/// ${line}`).join("\n") + "\n";
    }
    if (enumData.summary !== enumData.description && enumData.description !== "") {
        output += enumData.description.trim().split("\n").map(line => `/// ${line}`).join("\n") + "\n";
    }

    // Top-level deprecation
    if (enumData.deprecationMessage !== "") {
        output += `[[deprecated("${enumData.deprecationMessage}")]]\n`;
    }

    // Enum declaration
    output += `enum class ${enumData.name} : uint32_t {\n`;

    for (const item of enumData.items) {
        // Per-item comments
        if (item.summary !== "") {
            output += item.summary.trim().split("\n").map(line => `\t/// ${line}`).join("\n") + "\n";
        }

        // Per-item deprecation
        if (item.deprecationMessage !== "") {
            output += `\t[[deprecated(${JSON.stringify(item.deprecationMessage)})]]\n`;
        }

        // Item definition
        output += `\t${item.name} = ${item.value},\n`;
    }

    // Remove last comma safely
    output = output.trimEnd().replace(/,$/, "") + "\n";

    output += "};";

    return output;
}

const enumUrls = await getAllEnums();

let hppOutput = "/// Dumped by public main (@pubmain on discord and github)/// Dumped using https://github.com/pubmain/roblox-enum-dumper\n"
let rsOutput = `#![allow(dead_code)]\n#![allow(non_camel_case_types)]\n#![allow(deprecated)]\n${hppOutput}`

for (const index in enumUrls) {
    const url = enumUrls[index] as string;
    const response = await fetch(url);
    if (!response.body) {
        throw new Error("Request failed. Returned no body");
    }
    const body = await response.body.text();
    const document = parse(body);
    let stringData = document.querySelector("#__NEXT_DATA__")?.innerText;
    if (!stringData) {
        throw new Error("Failed to get __NEXT_DATA json data")
    }
    stringData = stringData.replaceAll(`](/`, `](https://create.roblox.com/docs/`)
    const data = JSON.parse(stringData);

    console.log(url, `${index}/${enumUrls.length}`)

    hppOutput += cppDisplayer(data.props.pageProps.data.apiReference) + "\n"
    rsOutput += rustDisplayer(data.props.pageProps.data.apiReference) + "\n"
}

await Bun.write("enums.hpp", hppOutput)
await Bun.write("enums.rs", rsOutput)