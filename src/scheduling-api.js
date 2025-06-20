const express = require('express');
const chrono = require('chrono-node');
const { DateTime } = require('luxon');
const timezoneMap = require('./timezoneMap.json');

const app = express();
const port = 3000;

function hasTimeForScheduling(text) {
    const timeIndicators = [
        // 12-hour format
        /\d{1,2}(?::\d{2})?\s*(?:am|pm|AM|PM)/,
        // 24-hour format with colons
        /\b(?:[01]?\d|2[0-3]):[0-5]\d\b/,
        // 4-digit military time (with or without timezone)
        /\b(?:[01]\d|2[0-3])[0-5]\d(?:\s*(?:hours?|hrs?|ist|est|pst|cst|utc|gmt|[+-]\d{1,2}(?::\d{2})?))?\b/i,
        // Word times
        /\b(?:noon|midnight|evening|morning|afternoon)\b/i,
        // "at X" patterns
        /\bat\s+\d/,
        // "X o'clock"
        /\d+\s*o'?clock/i
    ];

    return timeIndicators.some(pattern => pattern.test(text));
}

// ADD THIS NEW FUNCTION HERE (after the imports, before detectTimezone)
function preprocessText(text) {
    let processedText = text.trim();

    // Get current date info for context
    const now = new Date();
    const currentMonth = now.toLocaleString('en', { month: 'long' });

    // Pattern 1: "11pm on 23" or "11pm on 23rd" -> "11pm on 23rd of [current month]"
    processedText = processedText.replace(
        /\b(\d{1,2}(?::\d{2})?\s*(?:am|pm))\s+on\s+(\d{1,2})(?:st|nd|rd|th)?\b/gi,
        (match, time, day) => {
            const dayNum = parseInt(day);
            let suffix;
            if (dayNum >= 11 && dayNum <= 13) suffix = 'th';
            else if (dayNum % 10 === 1) suffix = 'st';
            else if (dayNum % 10 === 2) suffix = 'nd';
            else if (dayNum % 10 === 3) suffix = 'rd';
            else suffix = 'th';

            return `${time} on ${day}${suffix} of ${currentMonth}`;
        }
    );

    // Pattern 2: "23 11pm" or "23rd 11pm" -> "11pm on 23rd of [current month]"
    processedText = processedText.replace(
        /\b(\d{1,2})(?:st|nd|rd|th)?\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm))\b/gi,
        (match, day, time) => {
            const dayNum = parseInt(day);
            let suffix;
            if (dayNum >= 11 && dayNum <= 13) suffix = 'th';
            else if (dayNum % 10 === 1) suffix = 'st';
            else if (dayNum % 10 === 2) suffix = 'nd';
            else if (dayNum % 10 === 3) suffix = 'rd';
            else suffix = 'th';

            return `${time} on ${day}${suffix} of ${currentMonth}`;
        }
    );

    // Pattern 3: "11pm 23rd" -> "11pm on 23rd of [current month]"
    processedText = processedText.replace(
        /\b(\d{1,2}(?::\d{2})?\s*(?:am|pm))\s+(\d{1,2}(?:st|nd|rd|th))\b/gi,
        `$1 on $2 of ${currentMonth}`
    );

    // Pattern 4: Handle "at" variations like "at 11pm on 23"
    processedText = processedText.replace(
        /\bat\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm))\s+on\s+(\d{1,2})(?:st|nd|rd|th)?\b/gi,
        (match, time, day) => {
            const dayNum = parseInt(day);
            let suffix;
            if (dayNum >= 11 && dayNum <= 13) suffix = 'th';
            else if (dayNum % 10 === 1) suffix = 'st';
            else if (dayNum % 10 === 2) suffix = 'nd';
            else if (dayNum % 10 === 3) suffix = 'rd';
            else suffix = 'th';

            return `at ${time} on ${day}${suffix} of ${currentMonth}`;
        }
    );

    return processedText;
}

function detectTimezone(text) {
    const lowerText = text.toLowerCase();

    // Enhanced offset patterns to handle various formats (order matters!)
    const offsetPatterns = [
        // Special handling for "UTC 5:30" or "GMT 5:30" format (space separated with colon)
        { pattern: /\b(utc|gmt)\s+(\d{1,2}):(\d{2})\b/i, hasSign: false },
        // Special handling for "UTC 5" or "GMT 5" format (space separated without colon)
        { pattern: /\b(utc|gmt)\s+(\d{1,2})(?!\d)\b/i, hasSign: false },

        // UTC with space and signed offset: "UTC +5:30", "UTC -7:00"
        { pattern: /\butc\s+([+-])\s*(\d{1,2}):(\d{2})\b/i, hasSign: true },
        // UTC with space and signed offset (no colon): "UTC +5", "UTC -7"
        { pattern: /\butc\s+([+-])\s*(\d{1,2})(?!\d)\b/i, hasSign: true },

        // UTC with direct offset: "UTC+5:30", "UTC-7", "UTC+0530"
        { pattern: /\butc\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?\b/i, hasSign: true },

        // GMT with space and signed offset: "GMT +5:30", "GMT -7:00"
        { pattern: /\bgmt\s+([+-])\s*(\d{1,2}):(\d{2})\b/i, hasSign: true },
        // GMT with space and signed offset (no colon): "GMT +5", "GMT -7"
        { pattern: /\bgmt\s+([+-])\s*(\d{1,2})(?!\d)\b/i, hasSign: true },

        // GMT with direct offset: "GMT+5:30", "GMT-7", "GMT+0530"
        { pattern: /\bgmt\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?\b/i, hasSign: true },

        // Standalone timezone offsets: "+05:30", "-07:00", "+0530"
        { pattern: /\b([+-])(\d{1,2})(?::?(\d{2}))\b/, hasSign: true },
        // Simple hour offsets: "+5", "-7"
        { pattern: /\b([+-])(\d{1,2})\b/, hasSign: true }
    ];

    // Check offset patterns
    for (const { pattern, hasSign } of offsetPatterns) {
        const match = lowerText.match(pattern);
        if (match) {
            let sign, hours, minutes;

            if (hasSign) {
                sign = match[1] || '+'; // Default to positive if no sign
                hours = parseInt(match[2]);
                minutes = match[3] ? parseInt(match[3]) : 0;
            } else {
                // For patterns without explicit sign (like "UTC 5:30"), assume positive
                sign = '+';
                hours = parseInt(match[2]);
                minutes = match[3] ? parseInt(match[3]) : 0;
            }

            // Validate offset ranges
            if (hours > 14 || (hours === 14 && minutes > 0)) continue; // Max UTC+14
            if (hours > 12 && sign === '-') continue; // Max UTC-12

            // Convert to standard UTC offset format
            const totalMinutes = (hours * 60) + minutes;
            const offsetMinutes = sign === '+' ? totalMinutes : -totalMinutes;

            return `UTC_OFFSET_${offsetMinutes}`;
        }
    }

    // Look for timezone mentions in order of specificity (only if no offset found)
    for (const [key, timezone] of Object.entries(timezoneMap)) {
        const regex = new RegExp(`\\b${key}\\b`, 'i');
        if (regex.test(lowerText)) {
            return timezone;
        }
    }

    return null;
}

// NEW: Helper function to adjust dates to future
// NEW: Helper function to adjust dates to future
function adjustToFuture(jsDate, originalText, isEndDate = false, startDate = null) {
    const now = new Date();
    const oneDayMs = 24 * 60 * 60 * 1000;
    const oneWeekMs = 7 * oneDayMs;

    // If this is an end date in a range, ensure it's after the start date
    if (isEndDate && startDate) {
        // If end date is before start date, move it to next week
        if (jsDate.getTime() <= startDate.getTime()) {
            return new Date(jsDate.getTime() + oneWeekMs);
        }
        // If end date is valid but in the past, move both start and end forward
        if (jsDate.getTime() < now.getTime()) {
            const diffMs = jsDate.getTime() - startDate.getTime();
            const weeksToAdd = Math.ceil((now.getTime() - jsDate.getTime()) / oneWeekMs);
            return new Date(jsDate.getTime() + (weeksToAdd * oneWeekMs));
        }
        return jsDate;
    }

    // If the date is more than 1 hour in the past, adjust it forward
    if (jsDate.getTime() < (now.getTime() - (60 * 60 * 1000))) {
        const lowerText = originalText.toLowerCase();

        // Check if it's a day-of-week reference
        const dayOfWeekPattern = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;
        const weekendPattern = /\bweekend\b/i;

        if (dayOfWeekPattern.test(lowerText) || weekendPattern.test(lowerText)) {
            // For day-of-week references, move to next occurrence (add a week)
            return new Date(jsDate.getTime() + oneWeekMs);
        }

        // For date ranges like "15th to 20th", move to next month if past
        const dateRangePattern = /\d{1,2}(?:st|nd|rd|th)?\s+to\s+\d{1,2}(?:st|nd|rd|th)?/i;
        if (dateRangePattern.test(lowerText)) {
            const nextMonth = new Date(jsDate);
            nextMonth.setMonth(nextMonth.getMonth() + 1);
            return nextMonth;
        }

        // For other cases, try adding appropriate time periods
        if (jsDate.getTime() < (now.getTime() - oneWeekMs)) {
            // If more than a week old, move to next month
            const nextMonth = new Date(jsDate);
            nextMonth.setMonth(nextMonth.getMonth() + 1);
            return nextMonth;
        } else {
            // If less than a week old, move to next week
            return new Date(jsDate.getTime() + oneWeekMs);
        }
    }

    return jsDate;
}

function parseMultipleDays(text, detectedTimezone) {
    // Check if this looks like a weekly availability pattern
    const weeklyPattern = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+.*?to\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i;
    const match = text.match(weeklyPattern);

    if (!match) return null;

    const dayMap = {
        'monday': 1, 'tuesday': 2, 'wednesday': 3, 'thursday': 4,
        'friday': 5, 'saturday': 6, 'sunday': 0
    };

    const startDay = match[1].toLowerCase();
    const endDay = match[2].toLowerCase();
    const startDayNum = dayMap[startDay];
    const endDayNum = dayMap[endDay];

    // Extract time from the text
    const timeMatch = text.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
    if (!timeMatch) return null;

    const hour = parseInt(timeMatch[1]);
    const minute = parseInt(timeMatch[2]) || 0;
    const meridiem = timeMatch[3].toLowerCase();
    const hour24 = meridiem === 'pm' && hour !== 12 ? hour + 12 :
        meridiem === 'am' && hour === 12 ? 0 : hour;

    // Generate array of days between start and end
    const days = [];
    let currentDay = startDayNum;

    // Handle wrap-around week
    while (true) {
        days.push(currentDay);
        if (currentDay === endDayNum) break;
        currentDay = (currentDay + 1) % 7;
        // Prevent infinite loop
        if (days.length > 7) break;
    }

    // Create date objects for each day
    const now = new Date();
    const currentWeekday = now.getDay();
    const results = days.map(dayNum => {
        // Calculate days until this weekday
        let daysUntil = dayNum - currentWeekday;
        if (daysUntil <= 0) daysUntil += 7; // Next occurrence

        const targetDate = new Date(now);
        targetDate.setDate(now.getDate() + daysUntil);
        targetDate.setHours(hour24, minute, 0, 0);

        let finalDate = targetDate;
        let timezoneInfo = null;

        // Apply timezone if detected
        if (detectedTimezone) {
            if (detectedTimezone.startsWith('UTC_OFFSET_')) {
                const offsetMinutes = parseInt(detectedTimezone.replace('UTC_OFFSET_', ''));

                const dt = DateTime.fromJSDate(targetDate, { zone: 'UTC' }).minus({ minutes: offsetMinutes });

                finalDate = dt.toJSDate();

                const offsetHours = Math.floor(Math.abs(offsetMinutes) / 60);
                const offsetMins = Math.abs(offsetMinutes) % 60;
                const offsetSign = offsetMinutes >= 0 ? '+' : '-';
                const offsetStr = offsetMins > 0 ?
                    `${offsetSign}${offsetHours}:${String(offsetMins).padStart(2, '0')}` :
                    `${offsetSign}${offsetHours}`;

                timezoneInfo = {
                    timezone: `UTC${offsetStr}`,
                    offset: offsetMinutes,
                    offsetName: `UTC${offsetSign}${Math.abs(offsetMinutes / 60)}`,
                    zoneName: 'Manual Offset',
                    isManualOffset: true
                };
            } else {
                try {
                    // Create DateTime in the specified timezone
                    const dt = DateTime.fromObject({
                        year: targetDate.getFullYear(),
                        month: targetDate.getMonth() + 1,
                        day: targetDate.getDate(),
                        hour: hour24,
                        minute: minute
                    }, { zone: detectedTimezone });

                    if (dt.isValid) {
                        finalDate = dt.toJSDate();
                        timezoneInfo = {
                            timezone: detectedTimezone,
                            offset: dt.offset,
                            offsetName: dt.offsetNameShort,
                            zoneName: dt.zoneName,
                            isManualOffset: false
                        };
                    }
                } catch (error) {
                    console.warn('Timezone conversion failed:', error.message);
                }
            }
        }

        return {
            day: Object.keys(dayMap)[Object.values(dayMap).indexOf(dayNum)],
            jsDate: finalDate,
            timezoneInfo: timezoneInfo,
            unixTimestamp: Math.floor(finalDate.getTime() / 1000)
        };
    });

    return results;
}

function parseDateRange(text, detectedTimezone) {
    // Check for date range patterns like "15th to 20th at 10pm"
    const dateRangePattern = /(\d{1,2})(?:st|nd|rd|th)?\s+to\s+(\d{1,2})(?:st|nd|rd|th)?\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i;
    const match = text.match(dateRangePattern);

    if (!match) return null;

    const startDay = parseInt(match[1]);
    const endDay = parseInt(match[2]);
    const hour = parseInt(match[3]);
    const minute = parseInt(match[4]) || 0;
    const meridiem = match[5].toLowerCase();
    const hour24 = meridiem === 'pm' && hour !== 12 ? hour + 12 :
        meridiem === 'am' && hour === 12 ? 0 : hour;

    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    const results = [];

    // Generate dates for each day in the range
    for (let day = startDay; day <= endDay; day++) {
        let targetDate = new Date(currentYear, currentMonth, day, hour24, minute, 0, 0);

        // MODIFIED: Use the adjustToFuture function
        targetDate = adjustToFuture(targetDate, text);

        let finalDate = targetDate;
        let timezoneInfo = null;

        // Apply timezone if detected
        if (detectedTimezone) {
            if (detectedTimezone.startsWith('UTC_OFFSET_')) {
                const offsetMinutes = parseInt(detectedTimezone.replace('UTC_OFFSET_', ''));

                const dt = DateTime.fromJSDate(targetDate, { zone: 'UTC' }).minus({ minutes: offsetMinutes });

                finalDate = dt.toJSDate();

                const offsetHours = Math.floor(Math.abs(offsetMinutes) / 60);
                const offsetMins = Math.abs(offsetMinutes) % 60;
                const offsetSign = offsetMinutes >= 0 ? '+' : '-';
                const offsetStr = offsetMins > 0 ?
                    `${offsetSign}${offsetHours}:${String(offsetMins).padStart(2, '0')}` :
                    `${offsetSign}${offsetHours}`;

                timezoneInfo = {
                    timezone: `UTC${offsetStr}`,
                    offset: offsetMinutes,
                    offsetName: `UTC${offsetSign}${Math.abs(offsetMinutes / 60)}`,
                    zoneName: 'Manual Offset',
                    isManualOffset: true
                };
            } else {
                try {
                    const dt = DateTime.fromObject({
                        year: targetDate.getFullYear(),
                        month: targetDate.getMonth() + 1,
                        day: targetDate.getDate(),
                        hour: hour24,
                        minute: minute
                    }, { zone: detectedTimezone });

                    if (dt.isValid) {
                        finalDate = dt.toJSDate();
                        timezoneInfo = {
                            timezone: detectedTimezone,
                            offset: dt.offset,
                            offsetName: dt.offsetNameShort,
                            zoneName: dt.zoneName,
                            isManualOffset: false
                        };
                    }
                } catch (error) {
                    console.warn('Timezone conversion failed:', error.message);
                }
            }
        }

        results.push({
            day: day,
            jsDate: finalDate,
            timezoneInfo: timezoneInfo,
            unixTimestamp: Math.floor(finalDate.getTime() / 1000)
        });
    }

    return results;
}

// MODIFY THIS ENDPOINT - Replace the beginning of your /parse endpoint
app.get('/parse', (req, res) => {
    const originalText = req.query.text;

    if (!originalText) {
        return res.json({
            error: 'Missing text parameter',
            example: '/parse?text=tomorrow at 3pm bangladesh time'
        });
    }

    if (!hasTimeForScheduling(originalText)) {
        return res.json({
            original_text: originalText,
            found_dates: false,
            is_scheduling_relevant: false,
            message: 'No specific time found - not scheduling relevant'
        });
    }

    // PREPROCESSING STEP - normalize the text
    const text = preprocessText(originalText);

    // Log the preprocessing for debugging (remove in production)
    if (text !== originalText) {
        console.log(`Preprocessed: "${originalText}" -> "${text}"`);
    }

    // Detect timezone from text
    const detectedTimezone = detectTimezone(text);

    // Check for multiple days pattern first
    const multipleDaysResult = parseMultipleDays(text, detectedTimezone);

    if (multipleDaysResult) {
        return res.json({
            original_text: originalText, // Keep original in response
            preprocessed_text: text !== originalText ? text : undefined,
            found_dates: true,
            is_range: false,
            is_multiple_times: true,
            detected_timezone: detectedTimezone,
            timezone_info: multipleDaysResult[0].timezoneInfo,
            multiple_times: multipleDaysResult.map(result => ({
                day: result.day,
                unix_timestamp: result.unixTimestamp,
                readable_date: result.jsDate.toLocaleString(),
                iso_date: result.jsDate.toISOString(),
                utc_time: result.jsDate.toISOString()
            })),
            // Keep first result for backward compatibility
            unix_timestamp: multipleDaysResult[0].unixTimestamp,
            readable_date: multipleDaysResult[0].jsDate.toLocaleString(),
            iso_date: multipleDaysResult[0].jsDate.toISOString(),
            utc_time: multipleDaysResult[0].jsDate.toISOString(),
            message: `Found ${multipleDaysResult.length} recurring times`
        });
    }

    // Check for date range pattern
    const dateRangeResult = parseDateRange(text, detectedTimezone);

    if (dateRangeResult) {
        return res.json({
            original_text: originalText,
            preprocessed_text: text !== originalText ? text : undefined,
            found_dates: true,
            is_range: true,
            is_multiple_times: true,
            detected_timezone: detectedTimezone,
            timezone_info: dateRangeResult[0].timezoneInfo,
            multiple_times: dateRangeResult.map(result => ({
                day: result.day,
                unix_timestamp: result.unixTimestamp,
                readable_date: result.jsDate.toLocaleString(),
                iso_date: result.jsDate.toISOString(),
                utc_time: result.jsDate.toISOString()
            })),
            // Keep first result for backward compatibility
            unix_timestamp: dateRangeResult[0].unixTimestamp,
            readable_date: dateRangeResult[0].jsDate.toLocaleString(),
            iso_date: dateRangeResult[0].jsDate.toISOString(),
            utc_time: dateRangeResult[0].jsDate.toISOString(),
            message: `Found ${dateRangeResult.length} dates in range`
        });
    }

    // Parse the text with Chrono (fallback to original logic)
    const results = chrono.parse(text); // Now using preprocessed text

    if (results.length === 0) {
        return res.json({
            original_text: originalText,
            preprocessed_text: text !== originalText ? text : undefined,
            found_dates: false,
            is_range: false,
            is_multiple_times: false,
            detected_timezone: detectedTimezone,
            message: 'No dates found in the text'
        });
    }

    const result = results[0];

    // Helper function to process a chrono date component
    function processChronoDate(chronoComponent, timezone, isEndDate = false, startDate = null) {
        const year = chronoComponent.get('year');
        const month = chronoComponent.get('month');
        const day = chronoComponent.get('day');
        const hour = chronoComponent.get('hour');
        const minute = chronoComponent.get('minute');
        const second = chronoComponent.get('second') || 0;

        let initialDate = chronoComponent.date();

        // Apply future adjustment for scheduling with range awareness
        let adjustedDate = adjustToFuture(initialDate, originalText, isEndDate, startDate);

        let finalDate = adjustedDate;
        let timezoneInfo = null;

        if (timezone) {
            if (timezone.startsWith('UTC_OFFSET_')) {
                const offsetMinutes = parseInt(timezone.replace('UTC_OFFSET_', ''));

                try {
                    const specifiedTimeDt = DateTime.fromObject({
                        year: adjustedDate.getFullYear(),
                        month: adjustedDate.getMonth() + 1,
                        day: adjustedDate.getDate(),
                        hour, minute, second
                    }, { zone: 'UTC' }).minus({ minutes: offsetMinutes });

                    if (specifiedTimeDt.isValid) {
                        finalDate = specifiedTimeDt.toJSDate();

                        const offsetHours = Math.floor(Math.abs(offsetMinutes) / 60);
                        const offsetMins = Math.abs(offsetMinutes) % 60;
                        const offsetSign = offsetMinutes >= 0 ? '+' : '-';
                        const offsetStr = offsetMins > 0 ?
                            `${offsetSign}${offsetHours}:${String(offsetMins).padStart(2, '0')}` :
                            `${offsetSign}${offsetHours}`;

                        timezoneInfo = {
                            timezone: `UTC${offsetStr}`,
                            offset: offsetMinutes,
                            offsetName: `UTC${offsetSign}${Math.abs(offsetMinutes / 60)}`,
                            zoneName: 'Manual Offset',
                            isManualOffset: true,
                            originalTimeInTimezone: `${hour}:${String(minute).padStart(2, '0')} UTC${offsetStr}`
                        };
                    }
                } catch (error) {
                    console.warn('Manual offset conversion failed:', error.message);
                }
            } else {
                try {
                    // Create time in the specified timezone using adjusted date
                    const dt = DateTime.fromObject({
                        year: adjustedDate.getFullYear(),
                        month: adjustedDate.getMonth() + 1,
                        day: adjustedDate.getDate(),
                        hour, minute, second
                    }, { zone: timezone });

                    if (dt.isValid) {
                        finalDate = dt.toJSDate();
                        timezoneInfo = {
                            timezone: timezone,
                            offset: dt.offset,
                            offsetName: dt.offsetNameShort,
                            zoneName: dt.zoneName,
                            isManualOffset: false
                        };
                    }
                } catch (error) {
                    console.warn('Timezone conversion failed:', error.message);
                }
            }
        }

        return {
            jsDate: finalDate,
            timezoneInfo: timezoneInfo,
            unixTimestamp: Math.floor(finalDate.getTime() / 1000),
            wasAdjustedToFuture: finalDate.getTime() !== initialDate.getTime()
        };
    }

    // Process start time
    const startResult = processChronoDate(result.start, detectedTimezone);

    // Check if there's an end time (range)
    let endResult = null;
    let isRange = false;

    if (result.end) {
        isRange = true;
        // Pass the start date to ensure end date is after start date
        endResult = processChronoDate(result.end, detectedTimezone, true, startResult.jsDate);
    }

    // Build the response
    const response = {
        original_text: originalText,
        preprocessed_text: text !== originalText ? text : undefined,
        found_dates: true,
        is_range: isRange,
        is_multiple_times: false,
        detected_timezone: detectedTimezone,
        timezone_info: startResult.timezoneInfo,
        was_adjusted_to_future: startResult.wasAdjustedToFuture,

        // Start time info
        start_time: {
            unix_timestamp: startResult.unixTimestamp,
            readable_date: startResult.jsDate.toLocaleString(),
            iso_date: startResult.jsDate.toISOString(),
            utc_time: startResult.jsDate.toISOString()
        },

        // Legacy fields for backwards compatibility
        unix_timestamp: startResult.unixTimestamp,
        readable_date: startResult.jsDate.toLocaleString(),
        iso_date: startResult.jsDate.toISOString(),
        utc_time: startResult.jsDate.toISOString(),

        local_time_in_timezone: null,
        raw_chrono_result: result
    };

    // Add end time if it's a range
    if (isRange && endResult) {
        response.end_time = {
            unix_timestamp: endResult.unixTimestamp,
            readable_date: endResult.jsDate.toLocaleString(),
            iso_date: endResult.jsDate.toISOString(),
            utc_time: endResult.jsDate.toISOString()
        };

        // Calculate duration
        const durationMs = endResult.jsDate.getTime() - startResult.jsDate.getTime();
        response.duration = {
            milliseconds: durationMs,
            seconds: Math.floor(durationMs / 1000),
            minutes: Math.floor(durationMs / (1000 * 60)),
            hours: Math.floor(durationMs / (1000 * 60 * 60))
        };

        response.end_was_adjusted_to_future = endResult.wasAdjustedToFuture;
    }

    // Add timezone-specific display
    if (startResult.timezoneInfo) {
        if (startResult.timezoneInfo.isManualOffset) {
            response.local_time_in_timezone = startResult.timezoneInfo.originalTimeInTimezone;
            response.equivalent_utc = startResult.jsDate.toISOString();
        } else {
            const localDt = DateTime.fromJSDate(startResult.jsDate).setZone(detectedTimezone);
            response.local_time_in_timezone = localDt.toLocaleString(DateTime.DATETIME_FULL);

            if (isRange && endResult) {
                const endLocalDt = DateTime.fromJSDate(endResult.jsDate).setZone(detectedTimezone);
                response.end_local_time_in_timezone = endLocalDt.toLocaleString(DateTime.DATETIME_FULL);
            }
        }
    }

    res.json(response);
});

// Health check and examples
app.get('/', (req, res) => {
    res.json({
        status: 'running',
        timezone_support: 'Full production timezone support with Luxon + UTC/GMT offset parsing',
        scheduling_mode: 'Future dates prioritized for scheduling applications',
        endpoints: {
            parse: '/parse?text=your message here'
        },
        supported_timezones: `${Object.keys(timezoneMap).length} countries/cities/timezones supported`,
        sample_supported: Object.keys(timezoneMap).slice(0, 20).concat(['...']),
        examples: [
            '/parse?text=tomorrow at 3pm bangladesh time',
            '/parse?text=next friday 2pm UTC+5:30',
            '/parse?text=meeting at 9am GMT-7',
            '/parse?text=call at 5pm UTC +08:00',
            '/parse?text=conference 2pm australia time',
            '/parse?text=lunch at noon GMT+0',
            '/parse?text=party tonight 8pm UTC-5',
            '/parse?text=meeting monday 10am +0530',
            '/parse?text=deadline tomorrow 5pm GMT +05:30',
            '/parse?text=call next week 3pm -07:00',
            '/parse?text=meeting tomorrow 3pm UTC 5:30',
            '/parse?text=call at 2pm UTC 6:30',
            '/parse?text=playing at 10pm utc 5:00',
            '/parse?text=playing at 10pm utc 5',
            '/parse?text=gaming at 8pm UTC +7',
            '/parse?text=stream at 9pm GMT 2:30',
            '/parse?text=available on monday 10pm to thursday 10pm est',
            '/parse?text=available from 15th to 20th at 10pm netherlands',
            '/parse?text=available from 6pm to 10pm cdt on weekend',
            '/parse?text=10pm on saturday'
        ]
    });
});

// Error handling middleware
app.use((error, req, res, next) => {
    console.error('API Error:', error);
    res.status(500).json({
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
    });
});

app.listen(port, () => {
    console.log(`Production Chrono.js API with Future Date Logic running at http://localhost:${port}`);
    console.log(`Test: http://localhost:${port}/parse?text=available from 6pm to 10pm cdt on weekend`);
});