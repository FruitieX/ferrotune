//! XML response types for Subsonic API compatibility.
//! 
//! These structs mirror the JSON response types but use quick-xml's attribute
//! naming convention (`@field`) for XML serialization.

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

/// XML wrapper for subsonic-response element
/// Note: quick-xml doesn't support #[serde(flatten)] with complex types,
/// so we use specific response types for each endpoint instead of a generic wrapper.

/// Serialize to XML string with declaration
pub fn to_xml_string<T: Serialize>(value: &T) -> Result<String, quick_xml::se::SeError> {
    let mut xml = String::from("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
    xml.push_str(&quick_xml::se::to_string(value)?);
    Ok(xml)
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

/// License response
#[derive(Serialize)]
#[serde(rename = "subsonic-response")]
pub struct XmlLicenseResponse {
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
    pub license: XmlLicenseInner,
}

impl XmlLicenseResponse {
    pub fn ok(license: XmlLicenseInner) -> Self {
        Self {
            xmlns: "http://subsonic.org/restapi",
            status: "ok".to_string(),
            version: "1.16.1".to_string(),
            response_type: "ferrotune".to_string(),
            server_version: env!("CARGO_PKG_VERSION").to_string(),
            open_subsonic: true,
            license,
        }
    }
}

#[derive(Serialize)]
pub struct XmlLicenseInner {
    #[serde(rename = "@valid")]
    pub valid: bool,
    #[serde(rename = "@email")]
    pub email: String,
    #[serde(rename = "@licenseExpires")]
    pub license_expires: String,
}

/// Music folders response
#[derive(Serialize)]
#[serde(rename = "subsonic-response")]
pub struct XmlMusicFoldersResponse {
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
    #[serde(rename = "musicFolders")]
    pub music_folders: XmlMusicFoldersInner,
}

impl XmlMusicFoldersResponse {
    pub fn ok(music_folders: XmlMusicFoldersInner) -> Self {
        Self {
            xmlns: "http://subsonic.org/restapi",
            status: "ok".to_string(),
            version: "1.16.1".to_string(),
            response_type: "ferrotune".to_string(),
            server_version: env!("CARGO_PKG_VERSION").to_string(),
            open_subsonic: true,
            music_folders,
        }
    }
}

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

/// OpenSubsonic extensions response
#[derive(Serialize)]
#[serde(rename = "subsonic-response")]
pub struct XmlOpenSubsonicExtensionsResponse {
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
    #[serde(rename = "openSubsonicExtensions")]
    pub extensions: Vec<XmlExtension>,
}

impl XmlOpenSubsonicExtensionsResponse {
    pub fn ok(extensions: Vec<XmlExtension>) -> Self {
        Self {
            xmlns: "http://subsonic.org/restapi",
            status: "ok".to_string(),
            version: "1.16.1".to_string(),
            response_type: "ferrotune".to_string(),
            server_version: env!("CARGO_PKG_VERSION").to_string(),
            open_subsonic: true,
            extensions,
        }
    }
}

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

/// Artists response (getArtists)
#[derive(Serialize)]
#[serde(rename = "subsonic-response")]
pub struct XmlArtistsResponse {
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
    pub artists: XmlArtistsInner,
}

impl XmlArtistsResponse {
    pub fn ok(artists: XmlArtistsInner) -> Self {
        Self {
            xmlns: "http://subsonic.org/restapi",
            status: "ok".to_string(),
            version: "1.16.1".to_string(),
            response_type: "ferrotune".to_string(),
            server_version: env!("CARGO_PKG_VERSION").to_string(),
            open_subsonic: true,
            artists,
        }
    }
}

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
}

/// Artist detail response (getArtist)
#[derive(Serialize)]
#[serde(rename = "subsonic-response")]
pub struct XmlArtistWithAlbumsResponse {
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
    pub artist: XmlArtistDetail,
}

impl XmlArtistWithAlbumsResponse {
    pub fn ok(artist: XmlArtistDetail) -> Self {
        Self {
            xmlns: "http://subsonic.org/restapi",
            status: "ok".to_string(),
            version: "1.16.1".to_string(),
            response_type: "ferrotune".to_string(),
            server_version: env!("CARGO_PKG_VERSION").to_string(),
            open_subsonic: true,
            artist,
        }
    }
}

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
    #[serde(rename = "album", default)]
    pub album: Vec<XmlAlbum>,
}

/// Album response (getAlbum)
#[derive(Serialize)]
#[serde(rename = "subsonic-response")]
pub struct XmlAlbumDetailResponse {
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
    pub album: XmlAlbumDetail,
}

impl XmlAlbumDetailResponse {
    pub fn ok(album: XmlAlbumDetail) -> Self {
        Self {
            xmlns: "http://subsonic.org/restapi",
            status: "ok".to_string(),
            version: "1.16.1".to_string(),
            response_type: "ferrotune".to_string(),
            server_version: env!("CARGO_PKG_VERSION").to_string(),
            open_subsonic: true,
            album,
        }
    }
}

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
    #[serde(rename = "song", default)]
    pub song: Vec<XmlSong>,
}

/// Song response (getSong)
#[derive(Serialize)]
#[serde(rename = "subsonic-response")]
pub struct XmlSongDetailResponse {
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
    pub song: XmlSong,
}

impl XmlSongDetailResponse {
    pub fn ok(song: XmlSong) -> Self {
        Self {
            xmlns: "http://subsonic.org/restapi",
            status: "ok".to_string(),
            version: "1.16.1".to_string(),
            response_type: "ferrotune".to_string(),
            server_version: env!("CARGO_PKG_VERSION").to_string(),
            open_subsonic: true,
            song,
        }
    }
}

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
    #[serde(rename = "@created")]
    pub created: String,
    #[serde(rename = "@type")]
    pub media_type: String,
}

/// Genres response (getGenres)
#[derive(Serialize)]
#[serde(rename = "subsonic-response")]
pub struct XmlGenresResponse {
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
    pub genres: XmlGenresInner,
}

impl XmlGenresResponse {
    pub fn ok(genres: XmlGenresInner) -> Self {
        Self {
            xmlns: "http://subsonic.org/restapi",
            status: "ok".to_string(),
            version: "1.16.1".to_string(),
            response_type: "ferrotune".to_string(),
            server_version: env!("CARGO_PKG_VERSION").to_string(),
            open_subsonic: true,
            genres,
        }
    }
}

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

/// Album list response (getAlbumList2)
#[derive(Serialize)]
#[serde(rename = "subsonic-response")]
pub struct XmlAlbumList2Response {
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
    #[serde(rename = "albumList2")]
    pub album_list2: XmlAlbumList2Inner,
}

impl XmlAlbumList2Response {
    pub fn ok(album_list2: XmlAlbumList2Inner) -> Self {
        Self {
            xmlns: "http://subsonic.org/restapi",
            status: "ok".to_string(),
            version: "1.16.1".to_string(),
            response_type: "ferrotune".to_string(),
            server_version: env!("CARGO_PKG_VERSION").to_string(),
            open_subsonic: true,
            album_list2,
        }
    }
}

#[derive(Serialize)]
pub struct XmlAlbumList2Inner {
    #[serde(rename = "album", default)]
    pub album: Vec<XmlAlbum>,
}

/// Random songs response (getRandomSongs)
#[derive(Serialize)]
#[serde(rename = "subsonic-response")]
pub struct XmlRandomSongsResponse {
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
    #[serde(rename = "randomSongs")]
    pub random_songs: XmlRandomSongsInner,
}

impl XmlRandomSongsResponse {
    pub fn ok(random_songs: XmlRandomSongsInner) -> Self {
        Self {
            xmlns: "http://subsonic.org/restapi",
            status: "ok".to_string(),
            version: "1.16.1".to_string(),
            response_type: "ferrotune".to_string(),
            server_version: env!("CARGO_PKG_VERSION").to_string(),
            open_subsonic: true,
            random_songs,
        }
    }
}

#[derive(Serialize)]
pub struct XmlRandomSongsInner {
    #[serde(rename = "song", default)]
    pub song: Vec<XmlSong>,
}

/// Starred response (getStarred)
#[derive(Serialize)]
#[serde(rename = "subsonic-response")]
pub struct XmlStarredResponse {
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
    pub starred: XmlStarredInner,
}

impl XmlStarredResponse {
    pub fn ok(starred: XmlStarredInner) -> Self {
        Self {
            xmlns: "http://subsonic.org/restapi",
            status: "ok".to_string(),
            version: "1.16.1".to_string(),
            response_type: "ferrotune".to_string(),
            server_version: env!("CARGO_PKG_VERSION").to_string(),
            open_subsonic: true,
            starred,
        }
    }
}

/// Starred2 response (getStarred2)
#[derive(Serialize)]
#[serde(rename = "subsonic-response")]
pub struct XmlStarred2Response {
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
    pub starred2: XmlStarredInner,
}

impl XmlStarred2Response {
    pub fn ok(starred2: XmlStarredInner) -> Self {
        Self {
            xmlns: "http://subsonic.org/restapi",
            status: "ok".to_string(),
            version: "1.16.1".to_string(),
            response_type: "ferrotune".to_string(),
            server_version: env!("CARGO_PKG_VERSION").to_string(),
            open_subsonic: true,
            starred2,
        }
    }
}

#[derive(Serialize)]
pub struct XmlStarredInner {
    #[serde(rename = "artist", default, skip_serializing_if = "Vec::is_empty")]
    pub artist: Vec<XmlArtist>,
    #[serde(rename = "album", default, skip_serializing_if = "Vec::is_empty")]
    pub album: Vec<XmlAlbum>,
    #[serde(rename = "song", default, skip_serializing_if = "Vec::is_empty")]
    pub song: Vec<XmlSong>,
}

/// Search3 response (search3)
#[derive(Serialize)]
#[serde(rename = "subsonic-response")]
pub struct XmlSearchResult3Response {
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
    #[serde(rename = "searchResult3")]
    pub search_result3: XmlSearchResult3Inner,
}

impl XmlSearchResult3Response {
    pub fn ok(search_result3: XmlSearchResult3Inner) -> Self {
        Self {
            xmlns: "http://subsonic.org/restapi",
            status: "ok".to_string(),
            version: "1.16.1".to_string(),
            response_type: "ferrotune".to_string(),
            server_version: env!("CARGO_PKG_VERSION").to_string(),
            open_subsonic: true,
            search_result3,
        }
    }
}

#[derive(Serialize)]
pub struct XmlSearchResult3Inner {
    #[serde(rename = "artist", default, skip_serializing_if = "Vec::is_empty")]
    pub artist: Vec<XmlArtist>,
    #[serde(rename = "album", default, skip_serializing_if = "Vec::is_empty")]
    pub album: Vec<XmlAlbum>,
    #[serde(rename = "song", default, skip_serializing_if = "Vec::is_empty")]
    pub song: Vec<XmlSong>,
}

/// Playlists response (getPlaylists)
#[derive(Serialize)]
#[serde(rename = "subsonic-response")]
pub struct XmlPlaylistsResponse {
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
    pub playlists: XmlPlaylistsInner,
}

impl XmlPlaylistsResponse {
    pub fn ok(playlists: XmlPlaylistsInner) -> Self {
        Self {
            xmlns: "http://subsonic.org/restapi",
            status: "ok".to_string(),
            version: "1.16.1".to_string(),
            response_type: "ferrotune".to_string(),
            server_version: env!("CARGO_PKG_VERSION").to_string(),
            open_subsonic: true,
            playlists,
        }
    }
}

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

/// Playlist detail response (getPlaylist)
#[derive(Serialize)]
#[serde(rename = "subsonic-response")]
pub struct XmlPlaylistWithSongsResponse {
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
    pub playlist: XmlPlaylistDetail,
}

impl XmlPlaylistWithSongsResponse {
    pub fn ok(playlist: XmlPlaylistDetail) -> Self {
        Self {
            xmlns: "http://subsonic.org/restapi",
            status: "ok".to_string(),
            version: "1.16.1".to_string(),
            response_type: "ferrotune".to_string(),
            server_version: env!("CARGO_PKG_VERSION").to_string(),
            open_subsonic: true,
            playlist,
        }
    }
}

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

/// Play queue response (getPlayQueue)
#[derive(Serialize)]
#[serde(rename = "subsonic-response")]
pub struct XmlPlayQueueResponse {
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
    #[serde(rename = "playQueue")]
    pub play_queue: XmlPlayQueueInner,
}

impl XmlPlayQueueResponse {
    pub fn ok(play_queue: XmlPlayQueueInner) -> Self {
        Self {
            xmlns: "http://subsonic.org/restapi",
            status: "ok".to_string(),
            version: "1.16.1".to_string(),
            response_type: "ferrotune".to_string(),
            server_version: env!("CARGO_PKG_VERSION").to_string(),
            open_subsonic: true,
            play_queue,
        }
    }
}

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
