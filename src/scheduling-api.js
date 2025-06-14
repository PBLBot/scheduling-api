const express = require('express');
const chrono = require('chrono-node');
const { DateTime } = require('luxon');
const timezoneMap = require('./timezoneMap.json');

const app = express();
const port = 3000;

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
        const targetDate = new Date(currentYear, currentMonth, day, hour24, minute, 0, 0);

        // If the date is in the past, use next month
        if (targetDate < now) {
            targetDate.setMonth(currentMonth + 1);
        }

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

// Enhanced parsing endpoint with range support
app.get('/parse', (req, res) => {
    const text = req.query.text;

    if (!text) {
        return res.json({
            error: 'Missing text parameter',
            example: '/parse?text=tomorrow at 3pm bangladesh time'
        });
    }

    // Detect timezone from text
    const detectedTimezone = detectTimezone(text);

    // Check for multiple days pattern first
    const multipleDaysResult = parseMultipleDays(text, detectedTimezone);

    if (multipleDaysResult) {
        return res.json({
            original_text: text,
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
            original_text: text,
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
    const results = chrono.parse(text);

    if (results.length === 0) {
        return res.json({
            original_text: text,
            found_dates: false,
            is_range: false,
            is_multiple_times: false,
            detected_timezone: detectedTimezone,
            message: 'No dates found in the text'
        });
    }

    const result = results[0];

    // Helper function to process a chrono date component
    function processChronoDate(chronoComponent, timezone) {
        const year = chronoComponent.get('year');
        const month = chronoComponent.get('month');
        const day = chronoComponent.get('day');
        const hour = chronoComponent.get('hour');
        const minute = chronoComponent.get('minute');
        const second = chronoComponent.get('second') || 0;

        let finalDate = chronoComponent.date();
        let timezoneInfo = null;

        if (timezone) {
            if (timezone.startsWith('UTC_OFFSET_')) {
                const offsetMinutes = parseInt(timezone.replace('UTC_OFFSET_', ''));

                try {
                    const specifiedTimeDt = DateTime.fromObject({
                        year, month, day, hour, minute, second
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
                    // Create time in the specified timezone
                    const dt = DateTime.fromObject({
                        year, month, day, hour, minute, second
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
            unixTimestamp: Math.floor(finalDate.getTime() / 1000)
        };
    }

    // Process start time
    const startResult = processChronoDate(result.start, detectedTimezone);

    // Check if there's an end time (range)
    let endResult = null;
    let isRange = false;

    if (result.end) {
        isRange = true;
        endResult = processChronoDate(result.end, detectedTimezone);
    }

    // Build the response
    const response = {
        original_text: text,
        found_dates: true,
        is_range: isRange,
        is_multiple_times: false,
        detected_timezone: detectedTimezone,
        timezone_info: startResult.timezoneInfo,

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
            '/parse?text=available from 15th to 20th at 10pm netherlands'
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
    console.log(`Production Chrono.js API running at http://localhost:${port}`);
    console.log(`Test: http://localhost:${port}/parse?text=tomorrow at 3pm bangladesh time`);
});