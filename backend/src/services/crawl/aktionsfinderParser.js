const cheerio = require('cheerio');
const vm = require('node:vm');
const crypto = require('node:crypto');

function getScriptPushStrings(html) {
  const $ = cheerio.load(html);
  const pushes = [];

  $('script').each((index, element) => {
    const code = $(element).html() || '';

    if (!code.includes('self.__next_f.push(')) {
      return;
    }

    const context = {
      self: {
        __next_f: {
          push(entry) {
            pushes.push(entry);
          },
        },
      },
    };

    try {
      vm.runInNewContext(code, context, { timeout: 1000 });
    } catch (error) {
      // Some inline scripts are not relevant to the RSC payload and can be ignored.
    }
  });

  return pushes
    .map((entry) => entry?.[1])
    .filter((value) => typeof value === 'string');
}

function extractJsonObject(source, startIndex) {
  const braceStart = source.indexOf('{', startIndex);

  if (braceStart < 0) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let index = braceStart; index < source.length; index += 1) {
    const character = source[index];

    if (inString) {
      if (escape) {
        escape = false;
      } else if (character === '\\') {
        escape = true;
      } else if (character === '"') {
        inString = false;
      }

      continue;
    }

    if (character === '"') {
      inString = true;
      continue;
    }

    if (character === '{') {
      depth += 1;
    }

    if (character === '}') {
      depth -= 1;
    }

    if (depth === 0) {
      return source.slice(braceStart, index + 1);
    }
  }

  return null;
}

function parseSectionRecord(recordString, title) {
  const sectionStart = recordString.indexOf(`{"title":"${title}"`);

  if (sectionStart < 0) {
    return null;
  }

  const objectText = extractJsonObject(recordString, sectionStart);

  if (!objectText) {
    return null;
  }

  return JSON.parse(objectText);
}

function parseGroupRecord(recordString) {
  const sectionStart = recordString.indexOf('{"vendor":');

  if (sectionStart < 0) {
    return null;
  }

  const objectText = extractJsonObject(recordString, sectionStart);

  if (!objectText) {
    return null;
  }

  return JSON.parse(objectText);
}

function createContentHash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function buildPayloadDigest(html) {
  return {
    contentHash: createContentHash(html),
    contentSnippet: html.replace(/\s+/g, ' ').slice(0, 500),
  };
}

module.exports = {
  buildPayloadDigest,
  getScriptPushStrings,
  parseSectionRecord,
  parseGroupRecord,
};
