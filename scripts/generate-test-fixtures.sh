#!/usr/bin/env bash
# Generate test audio fixtures for integration tests
# Requires: ffmpeg
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FIXTURES_DIR="${SCRIPT_DIR}/../tests/fixtures"
MUSIC_DIR="${FIXTURES_DIR}/music"

echo "Generating test fixtures in ${FIXTURES_DIR}"

# Create directory structure
mkdir -p "${MUSIC_DIR}/Test Artist/Test Album"
mkdir -p "${MUSIC_DIR}/Another Artist/Another Album"
mkdir -p "${MUSIC_DIR}/Various Artists/Compilation Album"

# Generate a simple cover art image (red square with text)
generate_cover() {
    local output="$1"
    local color="$2"
    local text="$3"
    
    ffmpeg -y -f lavfi -i "color=c=${color}:size=500x500:duration=1" \
        -vf "drawtext=text='${text}':fontsize=48:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2" \
        -frames:v 1 "${output}" 2>/dev/null
    echo "Created cover: ${output}"
}

# Generate test audio file with metadata and embedded cover
# Args: output_path, title, artist, album, track_number, frequency, duration
generate_audio() {
    local output="$1"
    local title="$2"
    local artist="$3"
    local album="$4"
    local track="$5"
    local freq="$6"
    local duration="$7"
    local cover="$8"
    local year="${9:-2024}"
    local genre="${10:-Rock}"
    
    # Generate sine wave audio
    local temp_audio=$(mktemp --suffix=.wav)
    ffmpeg -y -f lavfi -i "sine=frequency=${freq}:duration=${duration}" \
        -ar 44100 -ac 2 "${temp_audio}" 2>/dev/null
    
    # Encode to MP3 with metadata and cover art
    ffmpeg -y -i "${temp_audio}" -i "${cover}" \
        -map 0:a -map 1:v \
        -c:a libmp3lame -b:a 192k \
        -c:v mjpeg -disposition:v attached_pic \
        -id3v2_version 3 \
        -metadata title="${title}" \
        -metadata artist="${artist}" \
        -metadata album="${album}" \
        -metadata track="${track}" \
        -metadata date="${year}" \
        -metadata genre="${genre}" \
        -metadata album_artist="${artist}" \
        "${output}" 2>/dev/null
    
    rm -f "${temp_audio}"
    echo "Created audio: ${output}"
}

# Generate FLAC file variant
generate_flac() {
    local output="$1"
    local title="$2"
    local artist="$3"
    local album="$4"
    local track="$5"
    local freq="$6"
    local duration="$7"
    local cover="$8"
    local year="${9:-2024}"
    local genre="${10:-Electronic}"
    
    # Generate sine wave audio
    local temp_audio=$(mktemp --suffix=.wav)
    ffmpeg -y -f lavfi -i "sine=frequency=${freq}:duration=${duration}" \
        -ar 44100 -ac 2 "${temp_audio}" 2>/dev/null
    
    # Encode to FLAC with metadata
    ffmpeg -y -i "${temp_audio}" \
        -c:a flac \
        -metadata title="${title}" \
        -metadata artist="${artist}" \
        -metadata album="${album}" \
        -metadata TRACKNUMBER="${track}" \
        -metadata DATE="${year}" \
        -metadata GENRE="${genre}" \
        -metadata ALBUMARTIST="${artist}" \
        "${output}" 2>/dev/null
    
    # Add cover art using metaflac if available, otherwise skip
    if command -v metaflac &> /dev/null; then
        metaflac --import-picture-from="${cover}" "${output}" 2>/dev/null || true
    fi
    
    rm -f "${temp_audio}"
    echo "Created audio: ${output}"
}

echo "=== Generating cover art ==="

# Generate cover art for each album
generate_cover "${MUSIC_DIR}/Test Artist/Test Album/cover.jpg" "red" "Test Album"
generate_cover "${MUSIC_DIR}/Another Artist/Another Album/cover.jpg" "blue" "Another"
generate_cover "${MUSIC_DIR}/Various Artists/Compilation Album/cover.jpg" "green" "Various"

# Also create a generic cover for the fixtures root
generate_cover "${FIXTURES_DIR}/cover.png" "purple" "Test"

echo ""
echo "=== Generating audio files ==="

# Test Artist - Test Album (3 tracks, different frequencies for verification)
# Frequencies: 440Hz (A4), 523Hz (C5), 659Hz (E5) - makes a chord if played together
generate_audio "${MUSIC_DIR}/Test Artist/Test Album/01 - First Song.mp3" \
    "First Song" "Test Artist" "Test Album" "1" "440" "3" \
    "${MUSIC_DIR}/Test Artist/Test Album/cover.jpg" "2024" "Rock"

generate_audio "${MUSIC_DIR}/Test Artist/Test Album/02 - Second Song.mp3" \
    "Second Song" "Test Artist" "Test Album" "2" "523" "4" \
    "${MUSIC_DIR}/Test Artist/Test Album/cover.jpg" "2024" "Rock"

generate_audio "${MUSIC_DIR}/Test Artist/Test Album/03 - Third Song.mp3" \
    "Third Song" "Test Artist" "Test Album" "3" "659" "5" \
    "${MUSIC_DIR}/Test Artist/Test Album/cover.jpg" "2024" "Rock"

# Another Artist - Another Album (2 tracks, FLAC format)
generate_flac "${MUSIC_DIR}/Another Artist/Another Album/01 - FLAC Track One.flac" \
    "FLAC Track One" "Another Artist" "Another Album" "1" "880" "3" \
    "${MUSIC_DIR}/Another Artist/Another Album/cover.jpg" "2023" "Electronic"

generate_flac "${MUSIC_DIR}/Another Artist/Another Album/02 - FLAC Track Two.flac" \
    "FLAC Track Two" "Another Artist" "Another Album" "2" "1047" "4" \
    "${MUSIC_DIR}/Another Artist/Another Album/cover.jpg" "2023" "Electronic"

# Various Artists - Compilation Album (mixed artists)
generate_audio "${MUSIC_DIR}/Various Artists/Compilation Album/01 - Compilation Track.mp3" \
    "Compilation Track" "Guest Artist" "Compilation Album" "1" "349" "3" \
    "${MUSIC_DIR}/Various Artists/Compilation Album/cover.jpg" "2022" "Pop"

generate_audio "${MUSIC_DIR}/Various Artists/Compilation Album/02 - Another Compilation.mp3" \
    "Another Compilation" "Different Artist" "Compilation Album" "2" "392" "3" \
    "${MUSIC_DIR}/Various Artists/Compilation Album/cover.jpg" "2022" "Pop"

# Standalone file for upload tests (tagger-extended)
generate_audio "${MUSIC_DIR}/simple.mp3" \
    "Unique Imported Song" "Unique Artist" "Unique Album" "1" "1000" "1" \
    "${FIXTURES_DIR}/cover.png" "2024" "Test"

echo ""
echo "=== Test fixtures generated ==="
echo "Music directory: ${MUSIC_DIR}"
echo ""
echo "Summary:"
echo "  - 3 artists"
echo "  - 3 albums"
echo "  - 7 tracks total (5 MP3, 2 FLAC)"
echo "  - Each track has unique frequency for stream verification"
echo ""
echo "Frequencies for stream testing:"
echo "  440Hz - Test Artist/First Song"
echo "  523Hz - Test Artist/Second Song"
echo "  659Hz - Test Artist/Third Song"
echo "  880Hz - Another Artist/FLAC Track One"
echo "  1047Hz - Another Artist/FLAC Track Two"
echo "  349Hz - Various Artists/Compilation Track"
echo "  392Hz - Various Artists/Another Compilation"
