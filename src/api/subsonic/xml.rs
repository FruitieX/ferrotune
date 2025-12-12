//! XML response types for Subsonic API compatibility.
//!
//! This module provides:
//! - `ToXml` trait for converting JSON response types to XML
//! - XML struct definitions for serialization with quick-xml
//! - Helper functions for XML serialization
//!
//! The `ToXml` trait allows API handlers to construct only JSON response types,
//! while `FormatResponse` automatically handles XML conversion when needed.

// Some XML response types are prepared for future use
#![allow(dead_code)]

use serde::Serialize;

/// Response format enum extracted from query params
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ResponseFormat {
    #[default]
    Xml,
    Json,
    Jsonp,
}

impl ResponseFormat {
    pub fn from_param(f: &str) -> Self {
        match f.to_lowercase().as_str() {
            "json" => ResponseFormat::Json,
            "jsonp" => ResponseFormat::Jsonp,
            _ => ResponseFormat::Xml,
        }
    }

    pub fn content_type(&self) -> &'static str {
        match self {
            ResponseFormat::Xml => "application/xml; charset=utf-8",
            ResponseFormat::Json | ResponseFormat::Jsonp => "application/json; charset=utf-8",
        }
    }
}

/// Trait for converting JSON response types to their XML equivalents.
///
/// Implementations should return a complete XML response struct that can be
/// serialized directly to XML (including the subsonic-response wrapper).
pub trait ToXml {
    /// The XML response type (must include the full subsonic-response wrapper)
    type XmlType: Serialize;

    /// Convert this JSON response to its XML equivalent
    fn to_xml(&self) -> Self::XmlType;
}

// Note: quick-xml doesn't support #[serde(flatten)] with complex types,
// so we use specific response types for each endpoint instead of a generic wrapper.

/// Serialize to XML string with declaration
pub fn to_xml_string<T: Serialize>(value: &T) -> Result<String, quick_xml::se::SeError> {
    let mut xml = String::from("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
    xml.push_str(&quick_xml::se::to_string(value)?);
    Ok(xml)
}

// ============================================================================
// XML Response Macro
// ============================================================================

/// Macro to generate XML response wrapper types with standard Subsonic headers.
///
/// This eliminates duplication of the 6 standard header fields across all response types.
///
/// Usage:
/// ```
/// xml_response!(XmlArtistsResponse, "artists", XmlArtistsInner, artists);
/// ```
/// Generates a struct with the standard headers plus the data field.
macro_rules! xml_response {
    // Standard response with a data field
    ($name:ident, $xml_field:literal, $data_type:ty, $data_field:ident) => {
        #[derive(Serialize)]
        #[serde(rename = "subsonic-response")]
        pub struct $name {
            #[serde(rename = "@xmlns")]
            pub xmlns: &'static str,
            #[serde(rename = "@status")]
            pub status: String,
            #[serde(rename = "@version")]
            pub version: String,
            #[serde(rename = "@type")]
            pub response_type: String,
            #[serde(rename = "@serverVersion")]
            pub server_version: String,
            #[serde(rename = "@openSubsonic")]
            pub open_subsonic: bool,
            #[serde(rename = $xml_field)]
            pub $data_field: $data_type,
        }

        impl $name {
            pub fn ok($data_field: $data_type) -> Self {
                Self {
                    xmlns: "http://subsonic.org/restapi",
                    status: "ok".to_string(),
                    version: "1.16.1".to_string(),
                    response_type: "ferrotune".to_string(),
                    server_version: env!("CARGO_PKG_VERSION").to_string(),
                    open_subsonic: true,
                    $data_field,
                }
            }
        }
    };

    // Response where XML field name matches Rust field name (no rename needed)
    ($name:ident, $data_type:ty, $data_field:ident) => {
        #[derive(Serialize)]
        #[serde(rename = "subsonic-response")]
        pub struct $name {
            #[serde(rename = "@xmlns")]
            pub xmlns: &'static str,
            #[serde(rename = "@status")]
            pub status: String,
            #[serde(rename = "@version")]
            pub version: String,
            #[serde(rename = "@type")]
            pub response_type: String,
            #[serde(rename = "@serverVersion")]
            pub server_version: String,
            #[serde(rename = "@openSubsonic")]
            pub open_subsonic: bool,
            pub $data_field: $data_type,
        }

        impl $name {
            pub fn ok($data_field: $data_type) -> Self {
                Self {
                    xmlns: "http://subsonic.org/restapi",
                    status: "ok".to_string(),
                    version: "1.16.1".to_string(),
                    response_type: "ferrotune".to_string(),
                    server_version: env!("CARGO_PKG_VERSION").to_string(),
                    open_subsonic: true,
                    $data_field,
                }
            }
        }
    };
}

/// Empty XML response (no data field, just the wrapper attributes)
#[derive(Serialize)]
#[serde(rename = "subsonic-response")]
pub struct XmlEmptyResponse {
    #[serde(rename = "@xmlns")]
    pub xmlns: &'static str,
    #[serde(rename = "@status")]
    pub status: String,
    #[serde(rename = "@version")]
    pub version: String,
    #[serde(rename = "@type")]
    pub response_type: String,
    #[serde(rename = "@serverVersion")]
    pub server_version: String,
    #[serde(rename = "@openSubsonic")]
    pub open_subsonic: bool,
}

impl XmlEmptyResponse {
    pub fn ok() -> Self {
        Self {
            xmlns: "http://subsonic.org/restapi",
            status: "ok".to_string(),
            version: "1.16.1".to_string(),
            response_type: "ferrotune".to_string(),
            server_version: env!("CARGO_PKG_VERSION").to_string(),
            open_subsonic: true,
        }
    }
}

// License response
xml_response!(XmlLicenseResponse, XmlLicenseInner, license);

#[derive(Serialize)]
pub struct XmlLicenseInner {
    #[serde(rename = "@valid")]
    pub valid: bool,
    #[serde(rename = "@email")]
    pub email: String,
    #[serde(rename = "@licenseExpires")]
    pub license_expires: String,
}

// Music folders response
xml_response!(
    XmlMusicFoldersResponse,
    "musicFolders",
    XmlMusicFoldersInner,
    music_folders
);

#[derive(Serialize)]
pub struct XmlMusicFoldersInner {
    #[serde(rename = "musicFolder", default)]
    pub music_folder: Vec<XmlMusicFolder>,
}

#[derive(Serialize)]
pub struct XmlMusicFolder {
    #[serde(rename = "@id")]
    pub id: i64,
    #[serde(rename = "@name")]
    pub name: String,
}

// OpenSubsonic extensions response
xml_response!(
    XmlOpenSubsonicExtensionsResponse,
    "openSubsonicExtensions",
    Vec<XmlExtension>,
    extensions
);

/// Error response
#[derive(Serialize)]
#[serde(rename = "subsonic-response")]
pub struct XmlErrorResponse {
    #[serde(rename = "@xmlns")]
    pub xmlns: &'static str,
    #[serde(rename = "@status")]
    pub status: String,
    #[serde(rename = "@version")]
    pub version: String,
    #[serde(rename = "@type")]
    pub response_type: String,
    #[serde(rename = "@serverVersion")]
    pub server_version: String,
    #[serde(rename = "@openSubsonic")]
    pub open_subsonic: bool,
    pub error: XmlError,
}

impl XmlErrorResponse {
    pub fn failed(error: XmlError) -> Self {
        Self {
            xmlns: "http://subsonic.org/restapi",
            status: "failed".to_string(),
            version: "1.16.1".to_string(),
            response_type: "ferrotune".to_string(),
            server_version: env!("CARGO_PKG_VERSION").to_string(),
            open_subsonic: true,
            error,
        }
    }
}

#[derive(Serialize)]
pub struct XmlError {
    #[serde(rename = "@code")]
    pub code: u32,
    #[serde(rename = "@message")]
    pub message: String,
}

#[derive(Serialize)]
#[serde(rename = "openSubsonicExtension")]
pub struct XmlExtension {
    #[serde(rename = "@name")]
    pub name: String,
    #[serde(rename = "@versions")]
    pub versions: String,
}

// Artists response (getArtists)
xml_response!(XmlArtistsResponse, XmlArtistsInner, artists);

#[derive(Serialize)]
pub struct XmlArtistsInner {
    #[serde(rename = "@ignoredArticles")]
    pub ignored_articles: String,
    #[serde(rename = "index", default)]
    pub index: Vec<XmlArtistIndex>,
}

#[derive(Serialize)]
pub struct XmlArtistIndex {
    #[serde(rename = "@name")]
    pub name: String,
    #[serde(rename = "artist", default)]
    pub artist: Vec<XmlArtist>,
}

#[derive(Serialize)]
pub struct XmlArtist {
    #[serde(rename = "@id")]
    pub id: String,
    #[serde(rename = "@name")]
    pub name: String,
    #[serde(rename = "@albumCount", skip_serializing_if = "Option::is_none")]
    pub album_count: Option<i64>,
    #[serde(rename = "@coverArt", skip_serializing_if = "Option::is_none")]
    pub cover_art: Option<String>,
    #[serde(rename = "@starred", skip_serializing_if = "Option::is_none")]
    pub starred: Option<String>,
    #[serde(rename = "@userRating", skip_serializing_if = "Option::is_none")]
    pub user_rating: Option<i32>,
}

// Artist detail response (getArtist)
xml_response!(XmlArtistWithAlbumsResponse, XmlArtistDetail, artist);

#[derive(Serialize)]
pub struct XmlArtistDetail {
    #[serde(rename = "@id")]
    pub id: String,
    #[serde(rename = "@name")]
    pub name: String,
    #[serde(rename = "@albumCount", skip_serializing_if = "Option::is_none")]
    pub album_count: Option<i64>,
    #[serde(rename = "@coverArt", skip_serializing_if = "Option::is_none")]
    pub cover_art: Option<String>,
    #[serde(rename = "@starred", skip_serializing_if = "Option::is_none")]
    pub starred: Option<String>,
    #[serde(rename = "@userRating", skip_serializing_if = "Option::is_none")]
    pub user_rating: Option<i32>,
    #[serde(rename = "album", default)]
    pub album: Vec<XmlAlbum>,
}

// Artist info response (getArtistInfo2)
xml_response!(
    XmlArtistInfo2Response,
    "artistInfo2",
    XmlArtistInfo2,
    artist_info2
);

#[derive(Serialize)]
pub struct XmlArtistInfo2 {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub biography: Option<String>,
    #[serde(rename = "musicBrainzId", skip_serializing_if = "Option::is_none")]
    pub music_brainz_id: Option<String>,
    #[serde(rename = "lastFmUrl", skip_serializing_if = "Option::is_none")]
    pub last_fm_url: Option<String>,
    #[serde(rename = "smallImageUrl", skip_serializing_if = "Option::is_none")]
    pub small_image_url: Option<String>,
    #[serde(rename = "mediumImageUrl", skip_serializing_if = "Option::is_none")]
    pub medium_image_url: Option<String>,
    #[serde(rename = "largeImageUrl", skip_serializing_if = "Option::is_none")]
    pub large_image_url: Option<String>,
    #[serde(
        rename = "similarArtist",
        default,
        skip_serializing_if = "Vec::is_empty"
    )]
    pub similar_artist: Vec<XmlArtist>,
}

// Album response (getAlbum)
xml_response!(XmlAlbumDetailResponse, XmlAlbumDetail, album);

#[derive(Serialize)]
pub struct XmlAlbum {
    #[serde(rename = "@id")]
    pub id: String,
    #[serde(rename = "@name")]
    pub name: String,
    #[serde(rename = "@artist")]
    pub artist: String,
    #[serde(rename = "@artistId")]
    pub artist_id: String,
    #[serde(rename = "@coverArt", skip_serializing_if = "Option::is_none")]
    pub cover_art: Option<String>,
    #[serde(rename = "@songCount")]
    pub song_count: i64,
    #[serde(rename = "@duration")]
    pub duration: i64,
    #[serde(rename = "@year", skip_serializing_if = "Option::is_none")]
    pub year: Option<i32>,
    #[serde(rename = "@genre", skip_serializing_if = "Option::is_none")]
    pub genre: Option<String>,
    #[serde(rename = "@created")]
    pub created: String,
    #[serde(rename = "@starred", skip_serializing_if = "Option::is_none")]
    pub starred: Option<String>,
    #[serde(rename = "@userRating", skip_serializing_if = "Option::is_none")]
    pub user_rating: Option<i32>,
}

#[derive(Serialize)]
pub struct XmlAlbumDetail {
    #[serde(rename = "@id")]
    pub id: String,
    #[serde(rename = "@name")]
    pub name: String,
    #[serde(rename = "@artist")]
    pub artist: String,
    #[serde(rename = "@artistId")]
    pub artist_id: String,
    #[serde(rename = "@coverArt", skip_serializing_if = "Option::is_none")]
    pub cover_art: Option<String>,
    #[serde(rename = "@songCount")]
    pub song_count: i64,
    #[serde(rename = "@duration")]
    pub duration: i64,
    #[serde(rename = "@year", skip_serializing_if = "Option::is_none")]
    pub year: Option<i32>,
    #[serde(rename = "@genre", skip_serializing_if = "Option::is_none")]
    pub genre: Option<String>,
    #[serde(rename = "@created")]
    pub created: String,
    #[serde(rename = "@starred", skip_serializing_if = "Option::is_none")]
    pub starred: Option<String>,
    #[serde(rename = "@userRating", skip_serializing_if = "Option::is_none")]
    pub user_rating: Option<i32>,
    #[serde(rename = "song", default)]
    pub song: Vec<XmlSong>,
}

// Song response (getSong)
xml_response!(XmlSongDetailResponse, XmlSong, song);

#[derive(Serialize)]
pub struct XmlSong {
    #[serde(rename = "@id")]
    pub id: String,
    #[serde(rename = "@title")]
    pub title: String,
    #[serde(rename = "@album", skip_serializing_if = "Option::is_none")]
    pub album: Option<String>,
    #[serde(rename = "@albumId", skip_serializing_if = "Option::is_none")]
    pub album_id: Option<String>,
    #[serde(rename = "@artist")]
    pub artist: String,
    #[serde(rename = "@artistId")]
    pub artist_id: String,
    #[serde(rename = "@track", skip_serializing_if = "Option::is_none")]
    pub track: Option<i32>,
    #[serde(rename = "@discNumber", skip_serializing_if = "Option::is_none")]
    pub disc_number: Option<i32>,
    #[serde(rename = "@year", skip_serializing_if = "Option::is_none")]
    pub year: Option<i32>,
    #[serde(rename = "@genre", skip_serializing_if = "Option::is_none")]
    pub genre: Option<String>,
    #[serde(rename = "@coverArt", skip_serializing_if = "Option::is_none")]
    pub cover_art: Option<String>,
    #[serde(rename = "@size")]
    pub size: i64,
    #[serde(rename = "@contentType")]
    pub content_type: String,
    #[serde(rename = "@suffix")]
    pub suffix: String,
    #[serde(rename = "@duration")]
    pub duration: i64,
    #[serde(rename = "@bitRate", skip_serializing_if = "Option::is_none")]
    pub bit_rate: Option<i32>,
    #[serde(rename = "@path")]
    pub path: String,
    #[serde(rename = "@starred", skip_serializing_if = "Option::is_none")]
    pub starred: Option<String>,
    #[serde(rename = "@userRating", skip_serializing_if = "Option::is_none")]
    pub user_rating: Option<i32>,
    #[serde(rename = "@created")]
    pub created: String,
    #[serde(rename = "@type")]
    pub media_type: String,
    // Ferrotune extensions
    #[serde(rename = "@fullPath", skip_serializing_if = "Option::is_none")]
    pub full_path: Option<String>,
    #[serde(rename = "@playCount", skip_serializing_if = "Option::is_none")]
    pub play_count: Option<i64>,
    #[serde(rename = "@lastPlayed", skip_serializing_if = "Option::is_none")]
    pub last_played: Option<String>,
}

// Genres response (getGenres)
xml_response!(XmlGenresResponse, XmlGenresInner, genres);

#[derive(Serialize)]
pub struct XmlGenresInner {
    #[serde(rename = "genre", default)]
    pub genre: Vec<XmlGenre>,
}

#[derive(Serialize)]
pub struct XmlGenre {
    #[serde(rename = "@songCount")]
    pub song_count: i64,
    #[serde(rename = "@albumCount")]
    pub album_count: i64,
    #[serde(rename = "$text")]
    pub name: String,
}

// Album list response (getAlbumList2)
xml_response!(
    XmlAlbumList2Response,
    "albumList2",
    XmlAlbumList2Inner,
    album_list2
);

#[derive(Serialize)]
pub struct XmlAlbumList2Inner {
    #[serde(rename = "album", default)]
    pub album: Vec<XmlAlbum>,
}

// Random songs response (getRandomSongs)
xml_response!(
    XmlRandomSongsResponse,
    "randomSongs",
    XmlRandomSongsInner,
    random_songs
);

#[derive(Serialize)]
pub struct XmlRandomSongsInner {
    #[serde(rename = "song", default)]
    pub song: Vec<XmlSong>,
}

// Songs by genre response (getSongsByGenre)
xml_response!(
    XmlSongsByGenreResponse,
    "songsByGenre",
    XmlSongsByGenreInner,
    songs_by_genre
);

#[derive(Serialize)]
pub struct XmlSongsByGenreInner {
    #[serde(rename = "song", default, skip_serializing_if = "Vec::is_empty")]
    pub song: Vec<XmlSong>,
}

// Starred response (getStarred)
xml_response!(XmlStarredResponse, XmlStarredInner, starred);

// Starred2 response (getStarred2)
xml_response!(XmlStarred2Response, XmlStarredInner, starred2);

#[derive(Serialize)]
pub struct XmlStarredInner {
    #[serde(rename = "artist", default, skip_serializing_if = "Vec::is_empty")]
    pub artist: Vec<XmlArtist>,
    #[serde(rename = "album", default, skip_serializing_if = "Vec::is_empty")]
    pub album: Vec<XmlAlbum>,
    #[serde(rename = "song", default, skip_serializing_if = "Vec::is_empty")]
    pub song: Vec<XmlSong>,
}

// Search3 response (search3)
xml_response!(
    XmlSearchResult3Response,
    "searchResult3",
    XmlSearchResult3Inner,
    search_result3
);

#[derive(Serialize)]
pub struct XmlSearchResult3Inner {
    #[serde(rename = "artist", default, skip_serializing_if = "Vec::is_empty")]
    pub artist: Vec<XmlArtist>,
    #[serde(rename = "album", default, skip_serializing_if = "Vec::is_empty")]
    pub album: Vec<XmlAlbum>,
    #[serde(rename = "song", default, skip_serializing_if = "Vec::is_empty")]
    pub song: Vec<XmlSong>,
    /// Total count of matching artists (Ferrotune extension for pagination)
    #[serde(rename = "@artistTotal", skip_serializing_if = "Option::is_none")]
    pub artist_total: Option<i64>,
    /// Total count of matching albums (Ferrotune extension for pagination)
    #[serde(rename = "@albumTotal", skip_serializing_if = "Option::is_none")]
    pub album_total: Option<i64>,
    /// Total count of matching songs (Ferrotune extension for pagination)
    #[serde(rename = "@songTotal", skip_serializing_if = "Option::is_none")]
    pub song_total: Option<i64>,
}

// Playlists response (getPlaylists)
xml_response!(XmlPlaylistsResponse, XmlPlaylistsInner, playlists);

#[derive(Serialize)]
pub struct XmlPlaylistsInner {
    #[serde(rename = "playlist", default)]
    pub playlist: Vec<XmlPlaylist>,
}

#[derive(Serialize)]
pub struct XmlPlaylist {
    #[serde(rename = "@id")]
    pub id: String,
    #[serde(rename = "@name")]
    pub name: String,
    #[serde(rename = "@comment", skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
    #[serde(rename = "@owner")]
    pub owner: String,
    #[serde(rename = "@public")]
    pub public: bool,
    #[serde(rename = "@songCount")]
    pub song_count: i64,
    #[serde(rename = "@duration")]
    pub duration: i64,
    #[serde(rename = "@created")]
    pub created: String,
    #[serde(rename = "@changed")]
    pub changed: String,
    #[serde(rename = "@coverArt", skip_serializing_if = "Option::is_none")]
    pub cover_art: Option<String>,
}

// Playlist detail response (getPlaylist)
xml_response!(XmlPlaylistWithSongsResponse, XmlPlaylistDetail, playlist);

#[derive(Serialize)]
pub struct XmlPlaylistDetail {
    #[serde(rename = "@id")]
    pub id: String,
    #[serde(rename = "@name")]
    pub name: String,
    #[serde(rename = "@comment", skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
    #[serde(rename = "@owner")]
    pub owner: String,
    #[serde(rename = "@public")]
    pub public: bool,
    #[serde(rename = "@songCount")]
    pub song_count: i64,
    #[serde(rename = "@duration")]
    pub duration: i64,
    #[serde(rename = "@created")]
    pub created: String,
    #[serde(rename = "@changed")]
    pub changed: String,
    #[serde(rename = "@coverArt", skip_serializing_if = "Option::is_none")]
    pub cover_art: Option<String>,
    #[serde(rename = "entry", default)]
    pub entry: Vec<XmlSong>,
}

// Play queue response (getPlayQueue)
xml_response!(
    XmlPlayQueueResponse,
    "playQueue",
    XmlPlayQueueInner,
    play_queue
);

#[derive(Serialize)]
pub struct XmlPlayQueueInner {
    #[serde(rename = "@current", skip_serializing_if = "Option::is_none")]
    pub current: Option<String>,
    #[serde(rename = "@position", skip_serializing_if = "Option::is_none")]
    pub position: Option<i64>,
    #[serde(rename = "@username", skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    #[serde(rename = "@changed", skip_serializing_if = "Option::is_none")]
    pub changed: Option<String>,
    #[serde(rename = "@changedBy", skip_serializing_if = "Option::is_none")]
    pub changed_by: Option<String>,
    #[serde(rename = "entry", default)]
    pub entry: Vec<XmlSong>,
}

// =============================================================================
// ToXml implementations for JSON response types
// =============================================================================
//
// These implementations convert JSON response structs to their XML equivalents.
// Each implementation handles the mapping from JSON field conventions (camelCase)
// to XML attribute conventions (@prefixed), and constructs the full XML response
// including the subsonic-response wrapper.

use crate::api::subsonic::browse::{
    AlbumDetailResponse, AlbumResponse, ArtistDetailResponse, ArtistInfo2Response, ArtistResponse,
    ArtistsResponse, GenresResponse, SongDetailResponse, SongResponse,
};
use crate::api::subsonic::lists::{AlbumList2Response, RandomSongsResponse, SongsByGenreResponse};
use crate::api::subsonic::playlists::{PlaylistWithSongsResponse, PlaylistsResponse};
use crate::api::subsonic::playqueue::PlayQueueResponse;
use crate::api::subsonic::search::SearchResult3;
use crate::api::subsonic::starring::{Starred2Response, StarredResponse};
use crate::api::subsonic::system::{License, MusicFolders, OpenSubsonicExtensions};

// --- Helper conversion functions ---

/// Convert a JSON ArtistResponse to XmlArtist
fn artist_to_xml(artist: &ArtistResponse) -> XmlArtist {
    XmlArtist {
        id: artist.id.clone(),
        name: artist.name.clone(),
        album_count: artist.album_count,
        cover_art: artist.cover_art.clone(),
        starred: artist.starred.clone(),
        user_rating: artist.user_rating,
    }
}

/// Convert a JSON AlbumResponse to XmlAlbum
fn album_to_xml(album: &AlbumResponse) -> XmlAlbum {
    XmlAlbum {
        id: album.id.clone(),
        name: album.name.clone(),
        artist: album.artist.clone(),
        artist_id: album.artist_id.clone(),
        cover_art: album.cover_art.clone(),
        song_count: album.song_count,
        duration: album.duration,
        year: album.year,
        genre: album.genre.clone(),
        created: album.created.clone(),
        starred: album.starred.clone(),
        user_rating: album.user_rating,
    }
}

/// Convert a JSON SongResponse to XmlSong
fn song_to_xml(song: &SongResponse) -> XmlSong {
    XmlSong {
        id: song.id.clone(),
        title: song.title.clone(),
        album: song.album.clone(),
        album_id: song.album_id.clone(),
        artist: song.artist.clone(),
        artist_id: song.artist_id.clone(),
        track: song.track,
        disc_number: song.disc_number,
        year: song.year,
        genre: song.genre.clone(),
        cover_art: song.cover_art.clone(),
        size: song.size,
        content_type: song.content_type.clone(),
        suffix: song.suffix.clone(),
        duration: song.duration,
        bit_rate: song.bit_rate,
        path: song.path.clone(),
        full_path: song.full_path.clone(),
        starred: song.starred.clone(),
        user_rating: song.user_rating,
        created: song.created.clone(),
        media_type: song.media_type.clone(),
        play_count: song.play_count,
        last_played: song.last_played.clone(),
    }
}

// --- system.rs ToXml implementations ---

impl ToXml for License {
    type XmlType = XmlLicenseResponse;

    fn to_xml(&self) -> Self::XmlType {
        XmlLicenseResponse::ok(XmlLicenseInner {
            valid: self.valid,
            email: self.email.clone(),
            license_expires: self.license_expires.clone(),
        })
    }
}

impl ToXml for OpenSubsonicExtensions {
    type XmlType = XmlOpenSubsonicExtensionsResponse;

    fn to_xml(&self) -> Self::XmlType {
        let extensions = self
            .open_subsonic_extensions
            .iter()
            .map(|ext| XmlExtension {
                name: ext.name.clone(),
                versions: ext
                    .versions
                    .iter()
                    .map(|v| v.to_string())
                    .collect::<Vec<_>>()
                    .join(","),
            })
            .collect();
        XmlOpenSubsonicExtensionsResponse::ok(extensions)
    }
}

impl ToXml for MusicFolders {
    type XmlType = XmlMusicFoldersResponse;

    fn to_xml(&self) -> Self::XmlType {
        let folders = self
            .music_folders
            .music_folder
            .iter()
            .map(|f| XmlMusicFolder {
                id: f.id,
                name: f.name.clone(),
            })
            .collect();
        XmlMusicFoldersResponse::ok(XmlMusicFoldersInner {
            music_folder: folders,
        })
    }
}

// --- browse.rs ToXml implementations ---

impl ToXml for ArtistsResponse {
    type XmlType = XmlArtistsResponse;

    fn to_xml(&self) -> Self::XmlType {
        let indexes = self
            .artists
            .index
            .iter()
            .map(|idx| XmlArtistIndex {
                name: idx.name.clone(),
                artist: idx.artist.iter().map(artist_to_xml).collect(),
            })
            .collect();

        XmlArtistsResponse::ok(XmlArtistsInner {
            ignored_articles: "The El La Los Las Le Les".to_string(),
            index: indexes,
        })
    }
}

impl ToXml for ArtistDetailResponse {
    type XmlType = XmlArtistWithAlbumsResponse;

    fn to_xml(&self) -> Self::XmlType {
        XmlArtistWithAlbumsResponse::ok(XmlArtistDetail {
            id: self.artist.id.clone(),
            name: self.artist.name.clone(),
            album_count: self.artist.album_count,
            cover_art: self.artist.cover_art.clone(),
            starred: self.artist.starred.clone(),
            user_rating: self.artist.user_rating,
            album: self.artist.album.iter().map(album_to_xml).collect(),
        })
    }
}

impl ToXml for ArtistInfo2Response {
    type XmlType = XmlArtistInfo2Response;

    fn to_xml(&self) -> Self::XmlType {
        XmlArtistInfo2Response::ok(XmlArtistInfo2 {
            biography: self.artist_info2.biography.clone(),
            music_brainz_id: self.artist_info2.music_brainz_id.clone(),
            last_fm_url: self.artist_info2.last_fm_url.clone(),
            small_image_url: self.artist_info2.small_image_url.clone(),
            medium_image_url: self.artist_info2.medium_image_url.clone(),
            large_image_url: self.artist_info2.large_image_url.clone(),
            similar_artist: self
                .artist_info2
                .similar_artist
                .iter()
                .map(artist_to_xml)
                .collect(),
        })
    }
}

impl ToXml for AlbumDetailResponse {
    type XmlType = XmlAlbumDetailResponse;

    fn to_xml(&self) -> Self::XmlType {
        XmlAlbumDetailResponse::ok(XmlAlbumDetail {
            id: self.album.id.clone(),
            name: self.album.name.clone(),
            artist: self.album.artist.clone(),
            artist_id: self.album.artist_id.clone(),
            cover_art: self.album.cover_art.clone(),
            song_count: self.album.song_count,
            duration: self.album.duration,
            year: self.album.year,
            genre: self.album.genre.clone(),
            created: self.album.created.clone(),
            starred: self.album.starred.clone(),
            user_rating: self.album.user_rating,
            song: self.album.song.iter().map(song_to_xml).collect(),
        })
    }
}

impl ToXml for SongDetailResponse {
    type XmlType = XmlSongDetailResponse;

    fn to_xml(&self) -> Self::XmlType {
        XmlSongDetailResponse::ok(song_to_xml(&self.song))
    }
}

impl ToXml for GenresResponse {
    type XmlType = XmlGenresResponse;

    fn to_xml(&self) -> Self::XmlType {
        let genres = self
            .genres
            .genre
            .iter()
            .map(|g| XmlGenre {
                name: g.name.clone(),
                song_count: g.song_count,
                album_count: g.album_count,
            })
            .collect();
        XmlGenresResponse::ok(XmlGenresInner { genre: genres })
    }
}

// --- lists.rs ToXml implementations ---

impl ToXml for AlbumList2Response {
    type XmlType = XmlAlbumList2Response;

    fn to_xml(&self) -> Self::XmlType {
        XmlAlbumList2Response::ok(XmlAlbumList2Inner {
            album: self.album_list2.album.iter().map(album_to_xml).collect(),
        })
    }
}

impl ToXml for RandomSongsResponse {
    type XmlType = XmlRandomSongsResponse;

    fn to_xml(&self) -> Self::XmlType {
        XmlRandomSongsResponse::ok(XmlRandomSongsInner {
            song: self.random_songs.song.iter().map(song_to_xml).collect(),
        })
    }
}

impl ToXml for SongsByGenreResponse {
    type XmlType = XmlSongsByGenreResponse;

    fn to_xml(&self) -> Self::XmlType {
        XmlSongsByGenreResponse::ok(XmlSongsByGenreInner {
            song: self.songs_by_genre.song.iter().map(song_to_xml).collect(),
        })
    }
}

// --- search.rs ToXml implementations ---

impl ToXml for SearchResult3 {
    type XmlType = XmlSearchResult3Response;

    fn to_xml(&self) -> Self::XmlType {
        XmlSearchResult3Response::ok(XmlSearchResult3Inner {
            artist: self
                .search_result3
                .artist
                .iter()
                .map(artist_to_xml)
                .collect(),
            album: self.search_result3.album.iter().map(album_to_xml).collect(),
            song: self.search_result3.song.iter().map(song_to_xml).collect(),
            artist_total: self.search_result3.artist_total,
            album_total: self.search_result3.album_total,
            song_total: self.search_result3.song_total,
        })
    }
}

// --- starring.rs ToXml implementations ---

impl ToXml for Starred2Response {
    type XmlType = XmlStarred2Response;

    fn to_xml(&self) -> Self::XmlType {
        XmlStarred2Response::ok(XmlStarredInner {
            artist: self.starred2.artist.iter().map(artist_to_xml).collect(),
            album: self.starred2.album.iter().map(album_to_xml).collect(),
            song: self.starred2.song.iter().map(song_to_xml).collect(),
        })
    }
}

impl ToXml for StarredResponse {
    type XmlType = XmlStarredResponse;

    fn to_xml(&self) -> Self::XmlType {
        XmlStarredResponse::ok(XmlStarredInner {
            artist: self.starred.artist.iter().map(artist_to_xml).collect(),
            album: self.starred.album.iter().map(album_to_xml).collect(),
            song: self.starred.song.iter().map(song_to_xml).collect(),
        })
    }
}

// --- playlists.rs ToXml implementations ---

impl ToXml for PlaylistsResponse {
    type XmlType = XmlPlaylistsResponse;

    fn to_xml(&self) -> Self::XmlType {
        let playlists = self
            .playlists
            .playlist
            .iter()
            .map(|p| XmlPlaylist {
                id: p.id.clone(),
                name: p.name.clone(),
                comment: p.comment.clone(),
                owner: p.owner.clone(),
                public: p.public,
                song_count: p.song_count,
                duration: p.duration,
                created: p.created.clone(),
                changed: p.changed.clone(),
                cover_art: p.cover_art.clone(),
            })
            .collect();
        XmlPlaylistsResponse::ok(XmlPlaylistsInner {
            playlist: playlists,
        })
    }
}

impl ToXml for PlaylistWithSongsResponse {
    type XmlType = XmlPlaylistWithSongsResponse;

    fn to_xml(&self) -> Self::XmlType {
        XmlPlaylistWithSongsResponse::ok(XmlPlaylistDetail {
            id: self.playlist.id.clone(),
            name: self.playlist.name.clone(),
            comment: self.playlist.comment.clone(),
            owner: self.playlist.owner.clone(),
            public: self.playlist.public,
            song_count: self.playlist.song_count,
            duration: self.playlist.duration,
            created: self.playlist.created.clone(),
            changed: self.playlist.changed.clone(),
            cover_art: self.playlist.cover_art.clone(),
            entry: self.playlist.entry.iter().map(song_to_xml).collect(),
        })
    }
}

// --- playqueue.rs ToXml implementations ---

impl ToXml for PlayQueueResponse {
    type XmlType = XmlPlayQueueResponse;

    fn to_xml(&self) -> Self::XmlType {
        XmlPlayQueueResponse::ok(XmlPlayQueueInner {
            current: self.play_queue.current.clone(),
            position: self.play_queue.position,
            username: self.play_queue.username.clone(),
            changed: self.play_queue.changed.clone(),
            changed_by: self.play_queue.changed_by.clone(),
            entry: self.play_queue.entry.iter().map(song_to_xml).collect(),
        })
    }
}

// --- Play History XML types (Ferrotune extension) ---

// Play history response (getPlayHistory)
xml_response!(
    XmlPlayHistoryResponse,
    "playHistory",
    XmlPlayHistoryInner,
    play_history
);

#[derive(Serialize)]
pub struct XmlPlayHistoryInner {
    #[serde(rename = "@total", skip_serializing_if = "Option::is_none")]
    pub total: Option<i64>,
    #[serde(rename = "entry", default)]
    pub entry: Vec<XmlPlayHistoryEntry>,
}

#[derive(Serialize)]
pub struct XmlPlayHistoryEntry {
    #[serde(rename = "@id")]
    pub id: String,
    #[serde(rename = "@title")]
    pub title: String,
    #[serde(rename = "@album", skip_serializing_if = "Option::is_none")]
    pub album: Option<String>,
    #[serde(rename = "@albumId", skip_serializing_if = "Option::is_none")]
    pub album_id: Option<String>,
    #[serde(rename = "@artist")]
    pub artist: String,
    #[serde(rename = "@artistId")]
    pub artist_id: String,
    #[serde(rename = "@track", skip_serializing_if = "Option::is_none")]
    pub track: Option<i32>,
    #[serde(rename = "@discNumber", skip_serializing_if = "Option::is_none")]
    pub disc_number: Option<i32>,
    #[serde(rename = "@year", skip_serializing_if = "Option::is_none")]
    pub year: Option<i32>,
    #[serde(rename = "@genre", skip_serializing_if = "Option::is_none")]
    pub genre: Option<String>,
    #[serde(rename = "@coverArt", skip_serializing_if = "Option::is_none")]
    pub cover_art: Option<String>,
    #[serde(rename = "@size")]
    pub size: i64,
    #[serde(rename = "@contentType")]
    pub content_type: String,
    #[serde(rename = "@suffix")]
    pub suffix: String,
    #[serde(rename = "@duration")]
    pub duration: i64,
    #[serde(rename = "@bitRate", skip_serializing_if = "Option::is_none")]
    pub bit_rate: Option<i32>,
    #[serde(rename = "@path")]
    pub path: String,
    #[serde(rename = "@starred", skip_serializing_if = "Option::is_none")]
    pub starred: Option<String>,
    #[serde(rename = "@userRating", skip_serializing_if = "Option::is_none")]
    pub user_rating: Option<i32>,
    #[serde(rename = "@created")]
    pub created: String,
    #[serde(rename = "@type")]
    pub media_type: String,
    #[serde(rename = "@playedAt")]
    pub played_at: String,
}

/// Convert a JSON SongResponse and played_at to XmlPlayHistoryEntry
fn play_history_entry_to_xml(song: &SongResponse, played_at: &str) -> XmlPlayHistoryEntry {
    XmlPlayHistoryEntry {
        id: song.id.clone(),
        title: song.title.clone(),
        album: song.album.clone(),
        album_id: song.album_id.clone(),
        artist: song.artist.clone(),
        artist_id: song.artist_id.clone(),
        track: song.track,
        disc_number: song.disc_number,
        year: song.year,
        genre: song.genre.clone(),
        cover_art: song.cover_art.clone(),
        size: song.size,
        content_type: song.content_type.clone(),
        suffix: song.suffix.clone(),
        duration: song.duration,
        bit_rate: song.bit_rate,
        path: song.path.clone(),
        starred: song.starred.clone(),
        user_rating: song.user_rating,
        created: song.created.clone(),
        media_type: song.media_type.clone(),
        played_at: played_at.to_string(),
    }
}

// --- history.rs ToXml implementations ---

use crate::api::subsonic::history::PlayHistoryResponse;

impl ToXml for PlayHistoryResponse {
    type XmlType = XmlPlayHistoryResponse;

    fn to_xml(&self) -> Self::XmlType {
        XmlPlayHistoryResponse::ok(XmlPlayHistoryInner {
            total: self.play_history.total,
            entry: self
                .play_history
                .entry
                .iter()
                .map(|e| play_history_entry_to_xml(&e.song, &e.played_at))
                .collect(),
        })
    }
}

// --- Directory browsing XML types (getIndexes, getMusicDirectory) ---

// Indexes response (getIndexes)
xml_response!(XmlIndexesResponse, XmlIndexesInner, indexes);

#[derive(Serialize)]
pub struct XmlIndexesInner {
    #[serde(rename = "@lastModified")]
    pub last_modified: i64,
    #[serde(rename = "@ignoredArticles")]
    pub ignored_articles: String,
    #[serde(rename = "shortcut", default, skip_serializing_if = "Vec::is_empty")]
    pub shortcut: Vec<XmlDirectoryChild>,
    #[serde(rename = "index", default)]
    pub index: Vec<XmlDirectoryIndex>,
    #[serde(rename = "child", default, skip_serializing_if = "Vec::is_empty")]
    pub child: Vec<XmlDirectoryChild>,
}

#[derive(Serialize)]
pub struct XmlDirectoryIndex {
    #[serde(rename = "@name")]
    pub name: String,
    #[serde(rename = "artist", default)]
    pub artist: Vec<XmlDirectoryArtist>,
}

#[derive(Serialize)]
pub struct XmlDirectoryArtist {
    #[serde(rename = "@id")]
    pub id: String,
    #[serde(rename = "@name")]
    pub name: String,
    #[serde(rename = "@starred", skip_serializing_if = "Option::is_none")]
    pub starred: Option<String>,
    #[serde(rename = "@userRating", skip_serializing_if = "Option::is_none")]
    pub user_rating: Option<i32>,
}

// Directory response (getMusicDirectory)
xml_response!(XmlDirectoryResponse, XmlDirectoryInner, directory);

#[derive(Serialize)]
pub struct XmlDirectoryInner {
    #[serde(rename = "@id")]
    pub id: String,
    #[serde(rename = "@parent", skip_serializing_if = "Option::is_none")]
    pub parent: Option<String>,
    #[serde(rename = "@name")]
    pub name: String,
    #[serde(rename = "@starred", skip_serializing_if = "Option::is_none")]
    pub starred: Option<String>,
    #[serde(rename = "@userRating", skip_serializing_if = "Option::is_none")]
    pub user_rating: Option<i32>,
    #[serde(rename = "child", default, skip_serializing_if = "Vec::is_empty")]
    pub child: Vec<XmlDirectoryChild>,
}

#[derive(Serialize)]
pub struct XmlDirectoryChild {
    #[serde(rename = "@id")]
    pub id: String,
    #[serde(rename = "@parent", skip_serializing_if = "Option::is_none")]
    pub parent: Option<String>,
    #[serde(rename = "@isDir")]
    pub is_dir: bool,
    #[serde(rename = "@title")]
    pub title: String,
    #[serde(rename = "@artist", skip_serializing_if = "Option::is_none")]
    pub artist: Option<String>,
    #[serde(rename = "@album", skip_serializing_if = "Option::is_none")]
    pub album: Option<String>,
    #[serde(rename = "@coverArt", skip_serializing_if = "Option::is_none")]
    pub cover_art: Option<String>,
    #[serde(rename = "@year", skip_serializing_if = "Option::is_none")]
    pub year: Option<i32>,
    #[serde(rename = "@genre", skip_serializing_if = "Option::is_none")]
    pub genre: Option<String>,
    #[serde(rename = "@track", skip_serializing_if = "Option::is_none")]
    pub track: Option<i32>,
    #[serde(rename = "@size", skip_serializing_if = "Option::is_none")]
    pub size: Option<i64>,
    #[serde(rename = "@contentType", skip_serializing_if = "Option::is_none")]
    pub content_type: Option<String>,
    #[serde(rename = "@suffix", skip_serializing_if = "Option::is_none")]
    pub suffix: Option<String>,
    #[serde(rename = "@duration", skip_serializing_if = "Option::is_none")]
    pub duration: Option<i64>,
    #[serde(rename = "@bitRate", skip_serializing_if = "Option::is_none")]
    pub bit_rate: Option<i32>,
    #[serde(rename = "@path", skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(rename = "@starred", skip_serializing_if = "Option::is_none")]
    pub starred: Option<String>,
    #[serde(rename = "@userRating", skip_serializing_if = "Option::is_none")]
    pub user_rating: Option<i32>,
    #[serde(rename = "@created", skip_serializing_if = "Option::is_none")]
    pub created: Option<String>,
}

// --- directory.rs ToXml implementations ---

use crate::api::subsonic::directory::{DirectoryChild, DirectoryResponse, IndexesResponse};

/// Convert a JSON DirectoryChild to XmlDirectoryChild
fn directory_child_to_xml(child: &DirectoryChild) -> XmlDirectoryChild {
    XmlDirectoryChild {
        id: child.id.clone(),
        parent: child.parent.clone(),
        is_dir: child.is_dir,
        title: child.title.clone(),
        artist: child.artist.clone(),
        album: child.album.clone(),
        cover_art: child.cover_art.clone(),
        year: child.year,
        genre: child.genre.clone(),
        track: child.track,
        size: child.size,
        content_type: child.content_type.clone(),
        suffix: child.suffix.clone(),
        duration: child.duration,
        bit_rate: child.bit_rate,
        path: child.path.clone(),
        starred: child.starred.clone(),
        user_rating: child.user_rating,
        created: child.created.clone(),
    }
}

impl ToXml for IndexesResponse {
    type XmlType = XmlIndexesResponse;

    fn to_xml(&self) -> Self::XmlType {
        XmlIndexesResponse::ok(XmlIndexesInner {
            last_modified: self.indexes.last_modified,
            ignored_articles: self.indexes.ignored_articles.clone(),
            shortcut: self
                .indexes
                .shortcut
                .iter()
                .map(directory_child_to_xml)
                .collect(),
            index: self
                .indexes
                .index
                .iter()
                .map(|idx| XmlDirectoryIndex {
                    name: idx.name.clone(),
                    artist: idx
                        .artist
                        .iter()
                        .map(|a| XmlDirectoryArtist {
                            id: a.id.clone(),
                            name: a.name.clone(),
                            starred: a.starred.clone(),
                            user_rating: a.user_rating,
                        })
                        .collect(),
                })
                .collect(),
            child: self
                .indexes
                .child
                .iter()
                .map(directory_child_to_xml)
                .collect(),
        })
    }
}

impl ToXml for DirectoryResponse {
    type XmlType = XmlDirectoryResponse;

    fn to_xml(&self) -> Self::XmlType {
        XmlDirectoryResponse::ok(XmlDirectoryInner {
            id: self.directory.id.clone(),
            parent: self.directory.parent.clone(),
            name: self.directory.name.clone(),
            starred: self.directory.starred.clone(),
            user_rating: self.directory.user_rating,
            child: self
                .directory
                .child
                .iter()
                .map(directory_child_to_xml)
                .collect(),
        })
    }
}
