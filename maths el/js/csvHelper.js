// ExamSlot - CSV Import, Validation, Parsing & Export Helper
// Fully compatible with Google Forms responses exported from Google Sheets,
// Excel CSV exports, and custom registration spreadsheets.

/**
 * Robust CSV Line Parser that handles quotes, escaped commas, and trimmed values
 * @param {string} text - Raw CSV text
 * @returns {Array<Array<string>>} 2D array of rows and columns
 */
export function parseCSV(text) {
  const lines = [];
  let currentRow = [];
  let currentVal = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        // Escaped quote: "" -> "
        currentVal += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      currentRow.push(currentVal.trim());
      currentVal = '';
    } else if ((char === '\r' || char === '\n') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') {
        i++;
      }
      currentRow.push(currentVal.trim());
      if (currentRow.some((field) => field.length > 0)) {
        lines.push(currentRow);
      }
      currentRow = [];
      currentVal = '';
    } else {
      currentVal += char;
    }
  }

  // Last value
  if (currentVal.length > 0 || currentRow.length > 0) {
    currentRow.push(currentVal.trim());
    if (currentRow.some((field) => field.length > 0)) {
      lines.push(currentRow);
    }
  }

  return lines;
}

/**
 * Detects headers and column mappings for standard format or Google Forms format
 * Google Forms headers commonly look like:
 * "Timestamp", "Student ID", "Full Name", "Department", "Semester", "Academic Year", "Registered Subjects"
 * @param {Array<string>} headers - Header row
 * @returns {Object} Column index mappings
 */
export function detectColumnMapping(headers) {
  const norm = headers.map((h) => h.toLowerCase().trim());

  const findIdx = (patterns) => {
    for (let p of patterns) {
      const idx = norm.findIndex((h) => h.includes(p));
      if (idx !== -1) return idx;
    }
    return -1;
  };

  let idIdx = findIdx(['student id', 'roll no', 'reg no', 'studentid', 'roll number', 'register no', 'registration no', 'usn', 'id', 'identifier']);
  // Fallback: If no explicit ID column, check for email or 2nd column after timestamp
  if (idIdx === -1) {
    idIdx = findIdx(['email', 'mail', 'roll', 'registration']);
    if (idIdx === -1 && norm.length >= 2 && norm[0].includes('timestamp')) {
      idIdx = 1; // standard Google Forms second column
    }
  }

  return {
    idIdx,
    nameIdx: findIdx(['name', 'student name', 'full name', 'candidate name']),
    deptIdx: findIdx(['department', 'dept', 'branch', 'program', 'stream']),
    semIdx: findIdx(['semester', 'sem', 'term']),
    yearIdx: findIdx(['academic year', 'year', 'batch', 'session']),
    subjectsIdx: findIdx([
      'select registered subjects',
      'registered subjects',
      'registered courses',
      'select courses',
      'select subjects',
      'subjects',
      'courses',
      'subject',
      'course',
      'papers'
    ])
  };
}

/**
 * Validates imported rows against current subjects and student list
 * @param {Array<Array<string>>} rows - Parsed CSV rows (including header)
 * @param {Array} existingSubjects - Array of { code, name, ... }
 * @param {Array} existingStudents - Array of current students
 * @returns {Object} Validation summary, valid records, invalid records, warnings
 */
export function validateImportedData(rows, existingSubjects, existingStudents = []) {
  if (!rows || rows.length < 2) {
    return {
      isValid: false,
      error: 'CSV file must contain a header row and at least one student record.',
      records: []
    };
  }

  const header = rows[0];
  const dataRows = rows.slice(1);
  const mapping = detectColumnMapping(header);

  if (mapping.idIdx === -1 || mapping.subjectsIdx === -1) {
    return {
      isValid: false,
      error: 'Could not detect required columns ("Student ID" and "Registered Subjects"). Please check CSV format.',
      mapping,
      records: []
    };
  }

  const validSubjectCodes = new Set(existingSubjects.map((s) => s.code.toUpperCase()));
  const existingStudentIds = new Set(existingStudents.map((s) => s.id.toUpperCase()));
  const seenBatchIds = new Set();

  const previewRecords = [];
  let validCount = 0;
  let duplicateCount = 0;
  let invalidSubjectCount = 0;

  dataRows.forEach((row, rowIndex) => {
    const rawId = (row[mapping.idIdx] || '').trim();
    const rawName = mapping.nameIdx !== -1 ? (row[mapping.nameIdx] || `Student ${rowIndex + 1}`).trim() : `Student ${rowIndex + 1}`;
    const rawDept = mapping.deptIdx !== -1 ? (row[mapping.deptIdx] || 'General').trim() : 'General';
    const rawSem = mapping.semIdx !== -1 ? (row[mapping.semIdx] || 'Sem 4').trim() : 'Sem 4';
    const rawYear = mapping.yearIdx !== -1 ? (row[mapping.yearIdx] || '2026-2027').trim() : '2026-2027';
    const rawSubjectsStr = (row[mapping.subjectsIdx] || '').trim();

    // Parse subjects (split by commas, semicolons, or slashes)
    const rawSubjectTokens = rawSubjectsStr
      .split(/[,;\/|]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    // Normalize and match subjects
    const recognizedSubjects = [];
    const unrecognizedTokens = [];

    rawSubjectTokens.forEach((tok) => {
      const cleanTok = tok.trim();
      const upperTok = cleanTok.toUpperCase();

      // 1. Direct code match (e.g., MATH, PY, COA, BE, DCN)
      if (validSubjectCodes.has(upperTok)) {
        if (!recognizedSubjects.includes(upperTok)) {
          recognizedSubjects.push(upperTok);
        }
        return;
      }

      // 2. Prefix code before hyphen, dash, or colon (e.g. "COA- Computer Architecture", "MATH - Mathematics", "BE- Biology")
      const prefixMatch = cleanTok.match(/^([A-Za-z0-9_]+)\s*[-:–—]/);
      if (prefixMatch) {
        const prefixCode = prefixMatch[1].toUpperCase();
        if (validSubjectCodes.has(prefixCode)) {
          if (!recognizedSubjects.includes(prefixCode)) {
            recognizedSubjects.push(prefixCode);
          }
          return;
        }
      }

      // 3. Word boundary regex match for any valid code (e.g. "Course COA", "(PY)")
      for (const code of validSubjectCodes) {
        const regex = new RegExp(`\\b${code}\\b`, 'i');
        if (regex.test(cleanTok)) {
          if (!recognizedSubjects.includes(code)) {
            recognizedSubjects.push(code);
          }
          return;
        }
      }

      // 4. Match by subject name (e.g., "Mathematics" -> "MATH", "Computer Architecture" -> "COA")
      const matchedByName = existingSubjects.find((s) => {
        const sName = s.name.toLowerCase();
        const tLower = cleanTok.toLowerCase();
        return tLower.includes(sName) || sName.includes(tLower);
      });
      if (matchedByName) {
        if (!recognizedSubjects.includes(matchedByName.code)) {
          recognizedSubjects.push(matchedByName.code);
        }
        return;
      }

      unrecognizedTokens.push(cleanTok);
    });

    const statusFlags = [];
    let isRowValid = true;

    if (!rawId) {
      statusFlags.push('Missing Student ID');
      isRowValid = false;
    } else {
      const upperId = rawId.toUpperCase();
      if (seenBatchIds.has(upperId)) {
        statusFlags.push('Duplicate ID in CSV');
        duplicateCount++;
        isRowValid = false;
      } else if (existingStudentIds.has(upperId)) {
        statusFlags.push('Overwrites Existing Student');
      }
      seenBatchIds.add(upperId);
    }

    if (unrecognizedTokens.length > 0) {
      statusFlags.push(`Unknown Subjects: ${unrecognizedTokens.join(', ')}`);
      invalidSubjectCount++;
    }

    if (recognizedSubjects.length < 1) {
      statusFlags.push('No Valid Subjects');
      isRowValid = false;
    }

    if (isRowValid && statusFlags.length === 0) {
      statusFlags.push('Valid');
      validCount++;
    } else if (isRowValid && statusFlags.every((f) => f.startsWith('Overwrites'))) {
      validCount++;
    }

    previewRecords.push({
      rowIndex: rowIndex + 2, // 1-based, accounting for header
      id: rawId.toUpperCase(),
      name: rawName,
      department: rawDept,
      semester: rawSem,
      academicYear: rawYear,
      subjects: recognizedSubjects,
      unrecognizedSubjects: unrecognizedTokens,
      rawSubjects: rawSubjectsStr,
      isValid: isRowValid && recognizedSubjects.length > 0,
      status: statusFlags.join('; ')
    });
  });

  return {
    isValid: true,
    totalRows: dataRows.length,
    validCount,
    duplicateCount,
    invalidSubjectCount,
    records: previewRecords
  };
}

/**
 * Generates CSV string for Examination Timetable export
 * @param {Object} timetable - Timetable object from generateTimetable
 * @returns {string} Formatted CSV content
 */
export function exportTimetableToCSV(timetable) {
  const headers = [
    'Slot Number',
    'Date',
    'Day',
    'Session',
    'Time Window',
    'Subject Codes',
    'Subject Names',
    'Total Students Writing',
    'Conflict Status'
  ];

  const rows = timetable.rows.map((row) => {
    const codes = row.subjects.map((s) => s.code).join('; ');
    const names = row.subjects.map((s) => s.name).join('; ');
    const conflictStatus = row.hasConflict ? 'CONFLICT DETECTED' : 'CONFLICT-FREE';

    return [
      `Slot ${row.slotNumber}`,
      `"${row.formattedDate}"`,
      `"${row.dayName}"`,
      `"${row.sessionType}"`,
      `"${row.sessionTime}"`,
      `"${codes}"`,
      `"${names}"`,
      row.totalStudents,
      `"${conflictStatus}"`
    ].join(',');
  });

  return [headers.join(','), ...rows].join('\r\n');
}

/**
 * Generates sample CSV template for standard student import
 * @returns {string} CSV template
 */
export function generateSampleStudentsCSV() {
  return [
    'Student ID,Full Name,Department,Semester,Academic Year,Registered Subjects',
    'STU101,Anil Kumble,Computer Science,Sem 4,2026-2027,"MATH, PY, COA"',
    'STU102,Smriti Mandhana,Information Technology,Sem 4,2026-2027,"JAVA, DCN, BE"',
    'STU103,Rohit Sharma,Computer Science,Sem 4,2026-2027,"OS, COA, PY"',
    'STU104,Harmanpreet Kaur,AI & Data Science,Sem 4,2026-2027,"MATH, BE, COA"',
    'STU105,Jasprit Bumrah,Information Technology,Sem 4,2026-2027,"JAVA, OS, DCN"'
  ].join('\r\n');
}

/**
 * Generates sample CSV matching Google Forms exported responses
 * @returns {string} CSV content
 */
export function generateGoogleFormsSampleCSV() {
  return [
    'Timestamp,Student ID,Student Name,Department,Semester,Academic Year,Select Registered Subjects',
    '2026-11-01 10:14:22,STU201,Kavita Krishnan,Computer Science,Sem 4,2026-2027,"MATH - Mathematics, PY - Python Programming, COA- Computer Architecture"',
    '2026-11-01 10:15:45,STU202,Devendra Soni,Information Technology,Sem 4,2026-2027,"JAVA - Java Programming, DCN- Data Communication and Networks, BE- Biology for Engineering"',
    '2026-11-01 10:18:10,STU203,Meera Nambiar,AI & Data Science,Sem 4,2026-2027,"OS - Operating Systems, COA- Computer Architecture, PY - Python Programming"',
    '2026-11-01 10:22:30,STU204,Farhan Akhtar,Computer Science,Sem 4,2026-2027,"MATH - Mathematics, OS - Operating Systems, BE- Biology for Engineering"',
    '2026-11-01 10:30:12,STU205,Ritika Sen,Information Technology,Sem 4,2026-2027,"JAVA - Java Programming, DCN- Data Communication and Networks, COA- Computer Architecture"'
  ].join('\r\n');
}

/**
 * Extracts a live fetchable CSV URL from any Google Sheets URL or ID
 * Preserves gid (worksheet ID) if present so the responses tab is fetched.
 * @param {string} input - Google Sheets URL, published URL, or Sheet ID
 * @returns {string} Live CSV endpoint URL
 */
export function extractGoogleSheetCsvUrl(input) {
  const trimmed = (input || '').trim();
  if (!trimmed) return '';

  if (trimmed.includes('pub?output=csv') || trimmed.includes('gviz/tq?tqx=out:csv') || trimmed.includes('export?format=csv')) {
    return trimmed;
  }

  // Extract Sheet ID
  const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  const sheetId = match ? match[1] : (/^[a-zA-Z0-9-_]{20,}$/.test(trimmed) ? trimmed : null);

  // Extract gid (tab ID)
  const gidMatch = trimmed.match(/[?&#]gid=([0-9]+)/);
  const gidParam = gidMatch ? `&gid=${gidMatch[1]}` : '';

  if (sheetId) {
    return `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv${gidParam}`;
  }

  return trimmed;
}

/**
 * Robustly fetches Google Sheet CSV data with automatic multi-tier CORS fallback.
 * Checks for Google Form URLs and Private/Restricted access permissions.
 * @param {string} input - Google Sheet URL or ID
 * @returns {Promise<string>} Raw CSV content
 */
export async function fetchGoogleSheetCSV(input) {
  const trimmed = (input || '').trim();
  if (!trimmed) {
    throw new Error('Please enter your Google Sheet URL or Sheet ID.');
  }

  // Check if user entered a Google Forms link
  if (trimmed.includes('/forms/') || trimmed.includes('forms.gle/')) {
    throw new Error(
      'NOTICE_GOOGLE_FORM: That is a Google Form link!\n\n' +
      'Google Forms stores student responses in a linked Google Sheet.\n\n' +
      'To connect in 3 quick steps:\n' +
      '1. Open your Google Form.\n' +
      '2. Click the "Responses" tab at top, then click the green Sheets icon ("View in Sheets").\n' +
      '3. In that Google Sheet, click "Share" (top-right) -> set to "Anyone with the link can view".\n' +
      '4. Copy that Google Sheet URL and paste it here!'
    );
  }

  // Extract sheet ID and gid
  const sheetMatch = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  const sheetId = sheetMatch ? sheetMatch[1] : (/^[a-zA-Z0-9-_]{20,}$/.test(trimmed) ? trimmed : null);
  const gidMatch = trimmed.match(/[?&#]gid=([0-9]+)/);
  const gid = gidMatch ? gidMatch[1] : null;
  const gidParam = gid ? `&gid=${gid}` : '';

  // Candidate direct endpoints
  const directUrls = [];
  if (trimmed.includes('pub?output=csv') || trimmed.includes('gviz/tq?tqx=out:csv') || trimmed.includes('export?format=csv')) {
    directUrls.push(trimmed);
  } else if (sheetId) {
    directUrls.push(`https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv${gidParam}`);
    directUrls.push(`https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv${gidParam}`);
  } else {
    directUrls.push(trimmed);
  }

  function isHtmlContent(txt) {
    if (!txt) return false;
    const lower = txt.trim().toLowerCase();
    return (
      lower.startsWith('<!doctype') ||
      lower.startsWith('<html') ||
      lower.includes('accounts.google.com') ||
      lower.includes('servicelogin') ||
      lower.includes('google drive')
    );
  }

  function isValidCsv(txt) {
    if (!txt || isHtmlContent(txt)) return false;
    return txt.includes(',') && (txt.includes('\n') || txt.includes('\r'));
  }

  let isRestricted = false;

  for (const url of directUrls) {
    // 1. Attempt direct fetch
    try {
      const resp = await fetch(url, { cache: 'no-cache' });
      if (resp.ok) {
        const text = await resp.text();
        if (isValidCsv(text)) return text;
        if (isHtmlContent(text)) isRestricted = true;
      }
    } catch (e) {
      // Direct CORS block or network failure, will try proxies
    }

    // 2. Attempt multi-tier CORS proxies
    const proxyUrls = [
      `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
      `https://corsproxy.io/?${encodeURIComponent(url)}`,
      `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`
    ];

    for (const pUrl of proxyUrls) {
      try {
        const pResp = await fetch(pUrl, { cache: 'no-cache' });
        if (pResp.ok) {
          const pText = await pResp.text();
          if (isValidCsv(pText)) return pText;
          if (isHtmlContent(pText)) isRestricted = true;
        }
      } catch (e) {
        // Continue to next proxy
      }
    }
  }

  if (isRestricted) {
    throw new Error(
      'RESTRICTED_ACCESS: The Google Sheet is set to "Restricted" (Private)!\n\n' +
      'Google requires public read permission so ExamSlot can fetch student registrations:\n\n' +
      '1. Open your Google Sheet in your browser.\n' +
      '2. Click the green/blue "Share" button at top-right.\n' +
      '3. Under "General access", change "Restricted" to "Anyone with the link" (Role: Viewer).\n' +
      '4. Click "Done" and click "Sync Responses Now" again!\n\n' +
      'Alternative: In Google Sheets, go to File -> Share -> Publish to web -> select "Comma-separated values (.csv)" -> click Publish.'
    );
  }

  throw new Error(
    'COULD_NOT_CONNECT: Could not fetch from Google Sheets.\n\n' +
    'Please verify that:\n' +
    '1. The Google Sheet URL is correct.\n' +
    '2. In the Google Sheet, Share -> General access is set to "Anyone with the link can view".\n' +
    '3. (Optional Guaranteed Method): In Google Sheets, click File -> Share -> Publish to web -> select "Comma-separated values (.csv)" -> Publish.'
  );
}

/**
 * Triggers browser download of a text/CSV file
 * @param {string} content - File content
 * @param {string} filename - Target filename
 */
export function downloadFile(content, filename, mimeType = 'text/csv;charset=utf-8;') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

