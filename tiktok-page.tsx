'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';

// ============================================================
// Types
// ============================================================
interface TikTokVideo {
  id: number;
  rank: number;
  video_url: string;
  creator_id: string;
  creator_name: string;
  description: string;
  posted_date: string;
  likes: string;
  comments: string;
  bookmarks: string;
  shares: string;
  views: string;
}

interface TikTokSearch {
  id: number;
  keyword: string;
  status: 'pending' | 'scraping' | 'completed' | 'failed';
  video_count: number;
  error: string | null;
  started_at: string;
  completed_at: string | null;
}

interface Keyword {
  id: number;
  keyword: string;
  is_active: boolean;
  search_count: string;
  last_searched: string | null;
}

// ============================================================
// API URL
// ============================================================
const API_URL = process.env.NEXT_PUBLIC_TIKTOK_API_URL || 'https://ev2-tiktok-analyzer-production.up.railway.app';

// ============================================================
// Component
// ============================================================
export default function TikTokAnalyzerPage() {
  const router = useRouter();

  // State
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [searches, setSearches] = useState<TikTokSearch[]>([]);
  const [selectedSearch, setSelectedSearch] = useState<TikTokSearch | null>(null);
  const [videos, setVideos] = useState<TikTokVideo[]>([]);

  const [newKeyword, setNewKeyword] = useState('');
  const [searchKeyword, setSearchKeyword] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchProgress, setSearchProgress] = useState(0);
  const [activeSearchId, setActiveSearchId] = useState<number | null>(null);
  const [error, setError] = useState('');

  // Tab state
  const [activeTab, setActiveTab] = useState<'search' | 'keywords' | 'history'>('search');

  // ============================================================
  // Data Fetching
  // ============================================================
  const fetchKeywords = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/tiktok/keywords`);
      const data = await res.json();
      if (data.success) setKeywords(data.data || []);
    } catch (err) {
      console.error('Failed to fetch keywords:', err);
    }
  }, []);

  const fetchSearches = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/tiktok/searches?limit=20`);
      const data = await res.json();
      if (data.success) setSearches(data.data || []);
    } catch (err) {
      console.error('Failed to fetch searches:', err);
    }
  }, []);

  const fetchSearchDetail = useCallback(async (searchId: number) => {
    try {
      const res = await fetch(`${API_URL}/api/tiktok/search/${searchId}`);
      const data = await res.json();
      if (data.success) {
        setSelectedSearch(data.data.search);
        setVideos(data.data.videos || []);
      }
    } catch (err) {
      console.error('Failed to fetch search detail:', err);
    }
  }, []);

  useEffect(() => {
    fetchKeywords();
    fetchSearches();
  }, [fetchKeywords, fetchSearches]);

  // ============================================================
  // Search Execution
  // ============================================================
  const startSearch = async (keyword: string) => {
    if (!keyword.trim()) return;
    setError('');
    setIsSearching(true);
    setSearchProgress(10);
    setVideos([]);
    setSelectedSearch(null);

    try {
      const res = await fetch(`${API_URL}/api/tiktok/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword: keyword.trim(), topN: 5 }),
      });
      const data = await res.json();

      if (!data.success) {
        throw new Error(data.error || '검색 시작 실패');
      }

      const searchId = data.searchId;
      setActiveSearchId(searchId);

      // Polling
      const poll = setInterval(async () => {
        try {
          const statusRes = await fetch(`${API_URL}/api/tiktok/search/${searchId}/status`);
          const statusData = await statusRes.json();
          const status = statusData.data?.status;
          const progress = statusData.data?.progress || 0;

          setSearchProgress(progress);

          if (status === 'completed') {
            clearInterval(poll);
            setIsSearching(false);
            setSearchProgress(100);
            setActiveSearchId(null);
            fetchSearchDetail(searchId);
            fetchSearches();
            fetchKeywords();
          } else if (status === 'failed') {
            clearInterval(poll);
            setIsSearching(false);
            setSearchProgress(0);
            setActiveSearchId(null);
            setError(statusData.data?.error || '분석 실패');
          }
        } catch {
          // polling error, continue
        }
      }, 3000);

      // Timeout 3분
      setTimeout(() => {
        clearInterval(poll);
        if (isSearching) {
          setIsSearching(false);
          setError('분석 시간 초과 (3분). 결과는 나중에 확인해주세요.');
        }
      }, 180000);

    } catch (err: any) {
      setIsSearching(false);
      setError(err.message || '검색 시작 오류');
    }
  };

  // ============================================================
  // Keyword Management
  // ============================================================
  const addKeyword = async () => {
    if (!newKeyword.trim()) return;
    try {
      await fetch(`${API_URL}/api/tiktok/keywords`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword: newKeyword.trim() }),
      });
      setNewKeyword('');
      fetchKeywords();
    } catch (err) {
      console.error('Failed to add keyword:', err);
    }
  };

  const deleteKeyword = async (id: number) => {
    try {
      await fetch(`${API_URL}/api/tiktok/keywords/${id}`, { method: 'DELETE' });
      fetchKeywords();
    } catch (err) {
      console.error('Failed to delete keyword:', err);
    }
  };

  // ============================================================
  // Helpers
  // ============================================================
  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  const formatNumber = (val: string) => {
    if (!val || val === 'N/A') return '-';
    const num = parseInt(val);
    if (isNaN(num)) return val;
    if (num >= 10000) return `${(num / 10000).toFixed(1)}만`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toLocaleString();
  };

  const statusBadge = (status: string) => {
    const styles: Record<string, string> = {
      pending: 'bg-gray-100 text-gray-600',
      scraping: 'bg-yellow-100 text-yellow-700',
      completed: 'bg-green-100 text-green-700',
      failed: 'bg-red-100 text-red-700',
    };
    const labels: Record<string, string> = {
      pending: '대기',
      scraping: '수집 중',
      completed: '완료',
      failed: '실패',
    };
    return (
      <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${styles[status] || styles.pending}`}>
        {labels[status] || status}
      </span>
    );
  };

  // ============================================================
  // Render
  // ============================================================
  return (
    <div className="min-h-screen bg-[#f8f9fb]">
      {/* Header */}
      <div className="bg-[#0F172A] text-white">
        <div className="max-w-6xl mx-auto px-6 py-6">
          <div className="flex items-center gap-3 mb-1">
            <button
              onClick={() => router.push('/ev2')}
              className="text-white/60 hover:text-white transition text-sm"
            >
              ← EV2
            </button>
            <span className="text-white/30">|</span>
            <span className="text-2xl">🎵</span>
            <h1 className="text-2xl font-bold tracking-tight">TikTok 광고 분석</h1>
          </div>
          <p className="text-white/60 text-sm mt-1">키워드 기반 TikTok 인기 콘텐츠 수집 · 분석</p>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-6">
        {/* Search Bar */}
        <div className="bg-white rounded-2xl border shadow-sm p-6 mb-6">
          <div className="flex gap-3">
            <input
              type="text"
              placeholder="검색 키워드 입력 (예: 메디큐브 PDRN)"
              value={searchKeyword}
              onChange={(e) => setSearchKeyword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !isSearching && startSearch(searchKeyword)}
              className="flex-1 px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#1E9EDE]/30 focus:border-[#1E9EDE]"
              disabled={isSearching}
            />
            <button
              onClick={() => startSearch(searchKeyword)}
              disabled={isSearching || !searchKeyword.trim()}
              className="px-6 py-3 bg-[#1E9EDE] text-white rounded-xl font-semibold text-sm hover:bg-[#1789c4] transition disabled:opacity-50 disabled:cursor-not-allowed active:scale-95"
            >
              {isSearching ? '분석 중...' : '🔍 검색'}
            </button>
          </div>

          {/* Progress Bar */}
          {isSearching && (
            <div className="mt-4">
              <div className="flex justify-between text-xs text-gray-500 mb-1">
                <span>TikTok 검색 결과 수집 중...</span>
                <span>{searchProgress}%</span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-2">
                <div
                  className="bg-[#1E9EDE] h-2 rounded-full transition-all duration-500"
                  style={{ width: `${searchProgress}%` }}
                />
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              ❌ {error}
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6">
          {[
            { key: 'search', label: '📊 검색 결과', count: videos.length },
            { key: 'keywords', label: '🏷️ 키워드 관리', count: keywords.length },
            { key: 'history', label: '📋 검색 이력', count: searches.length },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as any)}
              className={`px-4 py-2.5 rounded-xl text-sm font-medium transition ${
                activeTab === tab.key
                  ? 'bg-[#0F172A] text-white'
                  : 'bg-white text-gray-600 border hover:bg-gray-50'
              }`}
            >
              {tab.label}
              {tab.count > 0 && (
                <span className="ml-1.5 px-1.5 py-0.5 bg-white/20 rounded text-xs">
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Tab Content: Search Results */}
        {activeTab === 'search' && (
          <div>
            {selectedSearch && (
              <div className="bg-white rounded-2xl border shadow-sm p-5 mb-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-bold text-lg text-gray-900">
                      &quot;{selectedSearch.keyword}&quot; 검색 결과
                    </h3>
                    <p className="text-sm text-gray-500 mt-0.5">
                      {formatDate(selectedSearch.started_at)} · {selectedSearch.video_count}개 영상
                    </p>
                  </div>
                  {statusBadge(selectedSearch.status)}
                </div>
              </div>
            )}

            {videos.length > 0 ? (
              <div className="space-y-3">
                {videos.map((video) => (
                  <div
                    key={video.id}
                    className="bg-white rounded-2xl border shadow-sm p-5 hover:shadow-md transition"
                  >
                    <div className="flex items-start gap-4">
                      {/* Rank Badge */}
                      <div className="flex-shrink-0 w-10 h-10 bg-[#0F172A] text-white rounded-xl flex items-center justify-center font-bold text-lg">
                        {video.rank}
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        {/* Creator */}
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-semibold text-gray-900">{video.creator_name || '-'}</span>
                          <span className="text-gray-400 text-sm">@{video.creator_id || '-'}</span>
                          {video.posted_date && video.posted_date !== 'N/A' && (
                            <span className="text-gray-400 text-xs">· {video.posted_date}</span>
                          )}
                        </div>

                        {/* Description */}
                        {video.description && video.description !== 'N/A' && (
                          <p className="text-sm text-gray-600 mb-2 line-clamp-2">{video.description}</p>
                        )}

                        {/* Stats */}
                        <div className="flex gap-4 text-sm">
                          <span className="flex items-center gap-1 text-gray-500">
                            <span>❤️</span> {formatNumber(video.likes)}
                          </span>
                          <span className="flex items-center gap-1 text-gray-500">
                            <span>💬</span> {formatNumber(video.comments)}
                          </span>
                          <span className="flex items-center gap-1 text-gray-500">
                            <span>🔖</span> {formatNumber(video.bookmarks)}
                          </span>
                          <span className="flex items-center gap-1 text-gray-500">
                            <span>🔗</span> {formatNumber(video.shares)}
                          </span>
                          {video.views && video.views !== 'N/A' && (
                            <span className="flex items-center gap-1 text-gray-500">
                              <span>👁️</span> {formatNumber(video.views)}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Link */}
                      <a
                        href={video.video_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-shrink-0 px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-xs font-medium text-gray-600 transition"
                      >
                        TikTok →
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              !isSearching && (
                <div className="bg-white rounded-2xl border shadow-sm p-12 text-center">
                  <p className="text-4xl mb-3">🎵</p>
                  <p className="text-gray-500">키워드를 검색하면 TikTok 인기 콘텐츠가 여기에 표시됩니다</p>
                </div>
              )
            )}
          </div>
        )}

        {/* Tab Content: Keywords */}
        {activeTab === 'keywords' && (
          <div>
            {/* Add Keyword */}
            <div className="bg-white rounded-2xl border shadow-sm p-5 mb-4">
              <h3 className="font-semibold text-gray-900 mb-3">키워드 추가</h3>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="새 키워드 입력"
                  value={newKeyword}
                  onChange={(e) => setNewKeyword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addKeyword()}
                  className="flex-1 px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1E9EDE]/30"
                />
                <button
                  onClick={addKeyword}
                  className="px-4 py-2 bg-[#0F172A] text-white rounded-lg text-sm font-medium hover:bg-[#1e293b] transition"
                >
                  + 추가
                </button>
              </div>
            </div>

            {/* Keyword List */}
            <div className="space-y-2">
              {keywords.map((kw) => (
                <div
                  key={kw.id}
                  className="bg-white rounded-xl border p-4 flex items-center justify-between"
                >
                  <div>
                    <span className="font-medium text-gray-900">{kw.keyword}</span>
                    <span className="text-xs text-gray-400 ml-3">
                      검색 {kw.search_count}회
                      {kw.last_searched && ` · 마지막 ${formatDate(kw.last_searched)}`}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        setSearchKeyword(kw.keyword);
                        setActiveTab('search');
                        startSearch(kw.keyword);
                      }}
                      className="px-3 py-1.5 bg-[#1E9EDE] text-white rounded-lg text-xs font-medium hover:bg-[#1789c4] transition"
                    >
                      ▶ 검색
                    </button>
                    <button
                      onClick={() => deleteKeyword(kw.id)}
                      className="px-3 py-1.5 bg-red-50 text-red-600 rounded-lg text-xs font-medium hover:bg-red-100 transition"
                    >
                      삭제
                    </button>
                  </div>
                </div>
              ))}
              {keywords.length === 0 && (
                <div className="bg-white rounded-2xl border p-8 text-center text-gray-400">
                  등록된 키워드가 없습니다
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tab Content: History */}
        {activeTab === 'history' && (
          <div className="space-y-2">
            {searches.map((search) => (
              <div
                key={search.id}
                onClick={() => {
                  fetchSearchDetail(search.id);
                  setActiveTab('search');
                }}
                className="bg-white rounded-xl border p-4 flex items-center justify-between cursor-pointer hover:shadow-md transition"
              >
                <div>
                  <span className="font-medium text-gray-900">{search.keyword}</span>
                  <span className="text-xs text-gray-400 ml-3">
                    {formatDate(search.started_at)} · {search.video_count}개 영상
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  {statusBadge(search.status)}
                  <span className="text-gray-300">→</span>
                </div>
              </div>
            ))}
            {searches.length === 0 && (
              <div className="bg-white rounded-2xl border p-8 text-center text-gray-400">
                검색 이력이 없습니다
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
