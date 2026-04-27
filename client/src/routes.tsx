import {
  BrowserRouter,
  Navigate,
  Outlet,
  Route,
  Routes,
} from "react-router-dom";
import RootLayout from "@/app/layout";
import HomePage from "@/app/page";
import AdminPage from "@/app/admin/page";
import RecycleBinPage from "@/app/admin/recycle-bin/page";
import FavoritesPage from "@/app/favorites/page";
import HistoryPage from "@/app/history/page";
import HistoryManagePage from "@/app/history/manage/page";
import ImportPage from "@/app/import/page";
import LibraryLayout from "@/app/library/layout";
import LibraryPage from "@/app/library/page";
import AlbumsPage from "@/app/library/albums/page";
import AlbumDetailsPage from "@/app/library/albums/details/page";
import ArtistsPage from "@/app/library/artists/page";
import ArtistDetailsPage from "@/app/library/artists/details/page";
import FilesPage from "@/app/library/files/page";
import GenresPage from "@/app/library/genres/page";
import GenreDetailsPage from "@/app/library/genres/details/page";
import SongsPage from "@/app/library/songs/page";
import LoginPage from "@/app/login/page";
import PlaylistsPage from "@/app/playlists/page";
import PlaylistDetailsPage from "@/app/playlists/details/page";
import SmartPlaylistPage from "@/app/playlists/smart/page";
import ProfilePage from "@/app/profile/page";
import SongRadioPage from "@/app/radio/song/page";
import ReviewPage from "@/app/review/page";
import SearchPage from "@/app/search/page";
import SettingsPage from "@/app/settings/page";
import SetupLayout from "@/app/setup/layout";
import SetupPage from "@/app/setup/page";
import TaggerPage from "@/app/tagger/page";

function RootShell() {
  return (
    <RootLayout>
      <Outlet />
    </RootLayout>
  );
}

function LibraryShell() {
  return (
    <LibraryLayout>
      <Outlet />
    </LibraryLayout>
  );
}

export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<RootShell />}>
          <Route index element={<HomePage />} />
          <Route path="admin" element={<AdminPage />} />
          <Route path="admin/recycle-bin" element={<RecycleBinPage />} />
          <Route path="favorites" element={<FavoritesPage />} />
          <Route path="history" element={<HistoryPage />} />
          <Route path="history/manage" element={<HistoryManagePage />} />
          <Route path="import" element={<ImportPage />} />
          <Route path="library" element={<LibraryShell />}>
            <Route index element={<LibraryPage />} />
            <Route path="albums" element={<AlbumsPage />} />
            <Route path="albums/details" element={<AlbumDetailsPage />} />
            <Route path="artists" element={<ArtistsPage />} />
            <Route path="artists/details" element={<ArtistDetailsPage />} />
            <Route path="files" element={<FilesPage />} />
            <Route path="genres" element={<GenresPage />} />
            <Route path="genres/details" element={<GenreDetailsPage />} />
            <Route path="songs" element={<SongsPage />} />
          </Route>
          <Route path="login" element={<LoginPage />} />
          <Route path="playlists" element={<PlaylistsPage />} />
          <Route path="playlists/details" element={<PlaylistDetailsPage />} />
          <Route path="playlists/smart" element={<SmartPlaylistPage />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="radio/song" element={<SongRadioPage />} />
          <Route path="review" element={<ReviewPage />} />
          <Route path="search" element={<SearchPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route
            path="setup"
            element={
              <SetupLayout>
                <SetupPage />
              </SetupLayout>
            }
          />
          <Route path="tagger" element={<TaggerPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
