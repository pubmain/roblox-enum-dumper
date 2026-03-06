// these fix was done by claude:
// - faster speed
// - fix cpp file formatting

import { parse } from "node-html-parser";

const ENTRY_POINT = "https://create.roblox.com/docs/reference/engine/enums";
const CONCURRENCY  = 20;

interface EnumItem {
    name:               string;
    summary:            string;
    value:              number;
    tags:               string[];
    deprecationMessage: string;
}

interface EnumData {
    name:               string;
    summary:            string;
    description:        string;
    codeSamples:        string[];
    tags:               string[];
    deprecationMessage: string;
    items:              EnumItem[];
}

function docLines(text: string, indent = ""): string {
    return text.trim().split("\n").map(l => `${indent}/// ${l}`).join("\n");
}

async function fetchNextData(url: string): Promise<any> {
    const res  = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    const body = await res.text();
    const doc  = parse(body);
    const raw  = doc.querySelector("#__NEXT_DATA__")?.innerText;
    if (!raw) throw new Error(`No __NEXT_DATA__ at ${url}`);
    return JSON.parse(raw.replaceAll("](/", "](https://create.roblox.com/docs/"));
}

async function getAllEnumUrls(): Promise<string[]> {
    const data = await fetchNextData(ENTRY_POINT);
    return (data.props.pageProps.data.references.Enum as string[]).map(
        name => `https://create.roblox.com/docs/reference/engine/enums/${name}`
    );
}

async function fetchEnumData(url: string): Promise<EnumData> {
    const data = await fetchNextData(url);
    return data.props.pageProps.data.apiReference as EnumData;
}

async function fetchAll(urls: string[]): Promise<EnumData[]> {
    const results: EnumData[] = new Array(urls.length);
    let next = 0;

    async function worker() {
        while (next < urls.length) {
            const i   = next++;
            const url = urls[i]!;
            console.log(`[${i + 1}/${urls.length}] ${url}`);
            results[i] = await fetchEnumData(url);
        }
    }

    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    return results;
}

const CPP_RESERVED = new Set([
    "delete", "new", "inline", "return", "register", "for", "while",
    "if", "else", "switch", "case", "break", "continue", "default",
    "class", "struct", "union", "void", "int", "float", "double",
    "bool", "auto", "const", "static", "extern", "volatile", "typedef",
    "do", "goto", "try", "catch", "throw", "namespace", "template",
    "operator", "private", "public", "protected", "virtual", "explicit",
    "friend", "using", "typename", "this", "true", "false", "nullptr",
    "sizeof", "alignof", "decltype", "noexcept", "constexpr", "thread_local"
]);

function cppDisplayer(enumData: EnumData): string {
    if (enumData.items.length === 0) return "";

    let out = "";

    if (enumData.summary !== "") {
        out += docLines(enumData.summary) + "\n";
    }
    if (enumData.description !== "" && enumData.description !== enumData.summary) {
        out += docLines(enumData.description) + "\n";
    }
    if (enumData.deprecationMessage !== "") {
        out += `/// @deprecated ${enumData.deprecationMessage.trim().replaceAll("\n", " ")}\n`;
    }

    out += `enum class ${enumData.name} : uint32_t {\n`;

    for (let i = 0; i < enumData.items.length; i++) {
        const item     = enumData.items[i]!;
        const isLast   = i === enumData.items.length - 1;
        const safeName = CPP_RESERVED.has(item.name) ? `${item.name}_` : item.name;

        if (item.summary !== "") {
            out += docLines(item.summary, "\t") + "\n";
        }
        if (item.deprecationMessage !== "") {
            out += `\t/// @deprecated ${item.deprecationMessage.trim().replaceAll("\n", " ")}\n`;
        }

        out += `\t${safeName} = ${item.value}${isLast ? "" : ","}\n`;
    }

    out += "};";
    return out;
}

function rustDisplayer(enumData: EnumData): string {
    if (enumData.items.length === 0) return "";

    const items: EnumItem[] = enumData.items.map(item => ({
        ...item,
        name: item.name === "Self" ? "Self_" : item.name,
    }));

    let out = "";

    if (enumData.deprecationMessage !== "") {
        out += `#[deprecated = ${JSON.stringify(enumData.deprecationMessage)}]\n`;
    }
    if (enumData.summary !== "") {
        out += docLines(enumData.summary) + "\n";
    }
    if (enumData.description !== "" && enumData.description !== enumData.summary) {
        out += docLines(enumData.description) + "\n";
    }

    out += `#[derive(Debug, Clone, Copy, PartialEq, Eq)]\n`;
    out += `#[repr(u32)]\n`;
    out += `pub enum ${enumData.name} {\n`;

    for (const item of items) {
        if (item.summary !== "") {
            out += docLines(item.summary, "\t") + "\n";
        }
        if (item.deprecationMessage !== "") {
            out += `\t#[deprecated = ${JSON.stringify(item.deprecationMessage.trim())}]\n`;
        }
        out += `\t${item.name} = ${item.value},\n`;
    }

    out += "}\n";

    const n = enumData.name;

    out += `
impl PartialEq<u32> for ${n} {
    fn eq(&self, other: &u32) -> bool { *self as u32 == *other }
}

impl PartialEq<${n}> for u32 {
    fn eq(&self, other: &${n}) -> bool { *self == *other as u32 }
}

impl TryFrom<u32> for ${n} {
    type Error = &'static str;
    fn try_from(value: u32) -> Result<Self, Self::Error> {
        match value {
${items.map(item => `            ${item.value} => Ok(Self::${item.name}),`).join("\n")}
            _ => Err("Invalid value"),
        }
    }
}`;

    return out;
}

const HEADER = "/// Dumped by public main (@pubmain on discord and github)\n"
             + "/// Dumped using https://github.com/pubmain/roblox-enum-dumper\n\n";

const enumUrls = await getAllEnumUrls();
const allEnums = await fetchAll(enumUrls);

let hppOutput = `#pragma once\n#include <cstdint>\n\n${HEADER}`;
let rsOutput  = `#![allow(dead_code)]\n#![allow(non_camel_case_types)]\n#![allow(deprecated)]\n\n${HEADER}`;

for (const enumData of allEnums) {
    const cpp  = cppDisplayer(enumData);
    const rust = rustDisplayer(enumData);
    if (cpp)  hppOutput += cpp  + "\n\n";
    if (rust) rsOutput  += rust + "\n\n";
}

await Bun.write("enums.hpp", hppOutput.trimEnd() + "\n");
await Bun.write("enums.rs",  rsOutput.trimEnd()  + "\n");

console.log(`Done. Wrote ${allEnums.length} enums.`);
