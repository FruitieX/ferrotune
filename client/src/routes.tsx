import { lazy } from "react";
import {
  BrowserRouter,
  Navigate,
  Outlet,
  Route,
  Routes,
} from "react-router-dom";
import RootLayout from "@/app/layout";

const HomePage = lazy(() => import("@/app/page"));
const HomeSectionPage = lazy(() => import("@/app/home-section/page"));
const AdminPage = lazy(() => import("@/app/admin/page"));
const RecycleBinPage = lazy(() => import("@/app/admin/recycle-bin/page"));
const FavoritesPage = lazy(() => import("@/app/favorites/page"));
const HistoryPage = lazy(() => import("@/app/history/page"));
const HistoryManagePage = lazy(() => import("@/app/history/manage/page"));
const ImportPage = lazy(() => import("@/app/import/page"));
const LibraryLayout = lazy(() => import("@/app/library/layout"));
const LibraryPage = lazy(() => import("@/app/library/page"));
const AlbumsPage = lazy(() => import("@/app/library/albums/page"));
const AlbumDetailsPage = lazy(
  () => import("@/app/library/albums/details/page"),
);
const ArtistsPage = lazy(() => import("@/app/library/artists/page"));
const ArtistDetailsPage = lazy(
  () => import("@/app/library/artists/details/page"),
);
const FilesPage = lazy(() => import("@/app/library/files/page"));
const GenresPage = lazy(() => import("@/app/library/genres/page"));
const GenreDetailsPage = lazy(
  () => import("@/app/library/genres/details/page"),
);
const SongsPage = lazy(() => import("@/app/library/songs/page"));
const LoginPage = lazy(() => import("@/app/login/page"));
const PlaylistsPage = lazy(() => import("@/app/playlists/page"));
const PlaylistDetailsPage = lazy(() => import("@/app/playlists/details/page"));
const SmartPlaylistPage = lazy(() => import("@/app/playlists/smart/page"));
const ProfilePage = lazy(() => import("@/app/profile/page"));
const SongRadioPage = lazy(() => import("@/app/radio/song/page"));
const ReviewPage = lazy(() => import("@/app/review/page"));
const SearchPage = lazy(() => import("@/app/search/page"));
const SettingsPage = lazy(() => import("@/app/settings/page"));
const SetupLayout = lazy(() => import("@/app/setup/layout"));
const SetupPage = lazy(() => import("@/app/setup/page"));
const TaggerPage = lazy(() => import("@/app/tagger/page"));

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
          <Route path="home/:sectionId" element={<HomeSectionPage />} />
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
