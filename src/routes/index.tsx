import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { askNotes } from "@/lib/ask";
import {
  explainAuthError,
  fetchManuscript,
  getSupabase,
  isEditor,
  isRemoteStore,
  saveManuscript,
  signInWithPassword,
  signOut,
} from "@/lib/manuscript";
import { hasStoredVolumes, loadVolumes, saveVolumes, type Note, type Volume } from "@/lib/notes";

export const Route = createFileRoute("/")({ component: Home });

function byName(a: { name: string }, b: { name: string }) {
  return a.name.localeCompare(b.name, "zh-Hans-CN", { numeric: true });
}

function Home() {
  const remote = isRemoteStore();
  const [ready, setReady] = useState(false);
  const [volumes, setVolumes] = useState<Volume[]>([]);
  const [volumeId, setVolumeId] = useState("");
  const [activeId, setActiveId] = useState("");
  const [scope, setScope] = useState<"one" | "volume" | "all">("one");
  const [question, setQuestion] = useState("这里写了什么？");
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [savedHint, setSavedHint] = useState(remote ? "正在读取网上的稿" : "未写入");
  const [canEdit, setCanEdit] = useState(!remote);
  const [userEmail, setUserEmail] = useState("");
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [signingIn, setSigningIn] = useState(false);
  const writing = useRef(false);
  const saveTimer = useRef<number | null>(null);
  const serverEmpty = useRef(false);
  const pushedLocal = useRef(false);

  function openVolumes(loaded: Volume[]) {
    setVolumes(loaded);
    setVolumeId((current) =>
      loaded.some((item) => item.id === current) ? current : ([...loaded].sort(byName)[0]?.id ?? ""),
    );
    setActiveId((current) => {
      const still = loaded.some((item) => item.notes.some((note) => note.id === current));
      if (still) return current;
      const firstVolume = [...loaded].sort(byName)[0];
      return [...(firstVolume?.notes ?? [])].sort(byName)[0]?.id ?? "";
    });
  }

  useEffect(() => {
    if (remote) return;
    openVolumes(loadVolumes());
    setReady(true);
  }, [remote]);

  useEffect(() => {
    if (!remote) return;
    const sb = getSupabase();
    if (!sb) return;
    let cancel = false;

    fetchManuscript()
      .then((loaded) => {
        if (cancel) return;
        if (loaded.length > 0) {
          serverEmpty.current = false;
          openVolumes(loaded);
          saveVolumes(loaded);
          setSavedHint("已从网上打开");
        } else {
          serverEmpty.current = true;
          openVolumes(loadVolumes());
          setSavedHint("网上还没有稿");
        }
        setReady(true);
      })
      .catch(() => {
        if (cancel) return;
        openVolumes(loadVolumes());
        setSavedHint("网上没有打开，先显示本机稿");
        setReady(true);
      });

    const channel = sb
      .channel("manuscript")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "manuscript" },
        (payload) => {
          if (writing.current) return;
          const row = payload.new as { volumes?: unknown };
          if (!Array.isArray(row.volumes) || row.volumes.length === 0) return;
          serverEmpty.current = false;
          openVolumes(row.volumes as Volume[]);
          saveVolumes(row.volumes as Volume[]);
          setSavedHint("稿已更新");
        },
      )
      .subscribe();

    const { data: auth } = sb.auth.onAuthStateChange((_event, session) => {
      const email = session?.user.email ?? "";
      setUserEmail(email);
      if (!email) {
        setCanEdit(false);
        return;
      }
      void isEditor(email).then((allowed) => {
        if (!cancel) setCanEdit(allowed);
      });
    });

    return () => {
      cancel = true;
      void sb.removeChannel(channel);
      auth.subscription.unsubscribe();
    };
  }, [remote]);

  useEffect(() => {
    if (!remote || !canEdit || !serverEmpty.current || pushedLocal.current) return;
    if (!hasStoredVolumes()) return;
    pushedLocal.current = true;
    const local = loadVolumes();
    writing.current = true;
    saveManuscript(local)
      .then(() => {
        serverEmpty.current = false;
        openVolumes(local);
        setSavedHint("已把这台电脑上的稿写到网上");
      })
      .catch((err: unknown) => {
        pushedLocal.current = false;
        setSavedHint(explainAuthError(err instanceof Error ? err.message : ""));
      })
      .finally(() => {
        window.setTimeout(() => {
          writing.current = false;
        }, 800);
      });
  }, [remote, canEdit]);

  const orderedVolumes = useMemo(() => [...volumes].sort(byName), [volumes]);
  const volume = volumes.find((v) => v.id === volumeId) ?? orderedVolumes[0];
  const chapters = useMemo(
    () => [...(volume?.notes ?? [])].sort(byName),
    [volume],
  );
  const active = volume?.notes.find((n) => n.id === activeId) ?? chapters[0];
  const wordCount = active?.body.length ?? 0;
  const volumeCount = (volume?.notes ?? []).reduce((sum, n) => sum + n.body.length, 0);
  const total = volumes.reduce(
    (sum, v) => sum + v.notes.reduce((inner, n) => inner + n.body.length, 0),
    0,
  );

  function commit(next: Volume[]) {
    if (remote && !canEdit) return;
    setVolumes(next);
    saveVolumes(next);
    if (!remote) {
      setSavedHint("已写入本机浏览器");
      return;
    }
    setSavedHint("正在写到网上…");
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      writing.current = true;
      saveManuscript(next)
        .then(() => {
          serverEmpty.current = false;
          setSavedHint("已写到网上");
        })
        .catch((err: unknown) => {
          setSavedHint(explainAuthError(err instanceof Error ? err.message : ""));
        })
        .finally(() => {
          window.setTimeout(() => {
            writing.current = false;
          }, 800);
        });
    }, 600);
  }

  function patchVolume(id: string, notes: Note[], name?: string) {
    commit(
      volumes.map((v) =>
        v.id === id ? { ...v, name: name ?? v.name, notes } : v,
      ),
    );
  }

  function updateActive(patch: Partial<Note>) {
    if (!volume || !active) return;
    patchVolume(
      volume.id,
      volume.notes.map((n) =>
        n.id === active.id ? { ...n, ...patch, updatedAt: Date.now() } : n,
      ),
    );
  }

  function addVolume() {
    const id = `v-${Date.now()}`;
    const noteId = `n-${Date.now()}`;
    const next: Volume = {
      id,
      name: "新篇",
      notes: [{ id: noteId, name: "note1", body: "", updatedAt: Date.now() }],
    };
    commit([...volumes, next]);
    setVolumeId(id);
    setActiveId(noteId);
  }

  function removeVolume(id: string) {
    if (volumes.length <= 1) return;
    const next = volumes.filter((v) => v.id !== id);
    commit(next);
    if (volumeId === id) {
      const picked = [...next].sort(byName)[0];
      setVolumeId(picked.id);
      setActiveId([...picked.notes].sort(byName)[0]?.id ?? "");
    }
  }

  function addNote() {
    if (!volume) return;
    const id = `n-${Date.now()}`;
    const next: Note = {
      id,
      name: `note${volume.notes.length + 1}`,
      body: "",
      updatedAt: Date.now(),
    };
    patchVolume(volume.id, [...volume.notes, next]);
    setActiveId(id);
  }

  function removeNote(id: string) {
    if (!volume || volume.notes.length <= 1) return;
    const next = volume.notes.filter((n) => n.id !== id);
    patchVolume(volume.id, next);
    if (activeId === id) setActiveId([...next].sort(byName)[0].id);
  }

  async function onSignIn(event: FormEvent) {
    event.preventDefault();
    setSigningIn(true);
    setAuthError("");
    try {
      await signInWithPassword(loginEmail, loginPassword);
      setLoginPassword("");
    } catch (err: unknown) {
      setAuthError(explainAuthError(err instanceof Error ? err.message : ""));
    } finally {
      setSigningIn(false);
    }
  }

  async function onAsk() {
    if (!volume || !active || busy) return;
    setBusy(true);
    setError("");
    setAnswer("");
    const labeled = (vol: Volume, note: Note) => ({
      name: `${vol.name} / ${note.name}`,
      body: note.body,
    });
    const docs =
      scope === "all"
        ? orderedVolumes.flatMap((vol) =>
            [...vol.notes].sort(byName).map((note) => labeled(vol, note)),
          )
        : scope === "volume"
          ? chapters.map((note) => labeled(volume, note))
          : [labeled(volume, active)];
    try {
      const result = await askNotes({ data: { question, docs } });
      if (!result.ok) setError(result.error);
      else setAnswer(result.text);
    } catch {
      setError("回顾失败，请稍后再试。");
    } finally {
      setBusy(false);
    }
  }

  if (!ready || !volume || !active) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-desk text-paper">
        正在打开文稿…
      </main>
    );
  }

  return (
    <main className="min-h-screen overflow-x-hidden bg-desk p-2 sm:p-4">
      <div className="win-out mx-auto flex min-h-[calc(100vh-1rem)] max-w-6xl flex-col bg-face sm:min-h-[calc(100vh-2rem)]">
        <header className="flex items-center gap-2 bg-linear-to-r from-title to-title2 px-2 py-1 text-hilite-fg">
          <span className="grid size-4 place-items-center border border-hilite-fg text-[10px] leading-none">
            文
          </span>
          <h1 className="min-w-0 flex-1 truncate text-sm font-bold">小说整理.exe — 写作与情节回顾</h1>
          <span className="hidden text-xs sm:inline">{savedHint}</span>
        </header>

        {remote ? (
          <form
            onSubmit={onSignIn}
            className="flex flex-wrap items-center gap-1 border-b border-shadow px-2 py-1 text-xs"
          >
            {userEmail ? (
              <>
                <span className="min-w-0 truncate">{userEmail}</span>
                <span>{canEdit ? "可以修改" : "只能查看"}</span>
                <button
                  type="button"
                  className="win-btn"
                  onClick={() => {
                    void signOut();
                  }}
                >
                  退出
                </button>
              </>
            ) : (
              <>
                <label htmlFor="login-email">邮箱</label>
                <input
                  id="login-email"
                  type="email"
                  autoComplete="username"
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  className="win-in w-40 px-1 py-0.5"
                />
                <label htmlFor="login-password">密码</label>
                <input
                  id="login-password"
                  type="password"
                  autoComplete="current-password"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  className="win-in w-28 px-1 py-0.5"
                />
                <button type="submit" className="win-btn" disabled={signingIn}>
                  {signingIn ? "正在登录…" : "登录"}
                </button>
              </>
            )}
            {authError ? <span>{authError}</span> : null}
            {!canEdit ? <span className="text-muted">未登录或邮箱不在名单里时，只能看，不能改。</span> : null}
          </form>
        ) : null}

        <div className="flex flex-wrap items-center gap-1 border-b border-shadow px-2 py-1">
          <button type="button" className="win-btn disabled:opacity-50" onClick={addVolume} disabled={!canEdit}>
            新建篇
          </button>
          <button
            type="button"
            className="win-btn disabled:opacity-50"
            onClick={() => removeVolume(volume.id)}
            disabled={!canEdit || volumes.length <= 1}
          >
            删除篇
          </button>
          <button type="button" className="win-btn disabled:opacity-50" onClick={addNote} disabled={!canEdit}>
            新建章节
          </button>
          <button
            type="button"
            className="win-btn disabled:opacity-50"
            onClick={() => removeNote(active.id)}
            disabled={!canEdit || volume.notes.length <= 1}
          >
            删除章节
          </button>
          <a className="win-btn" href="/novel-netlify.zip" download="novel-netlify.zip">
            下载源码
          </a>
          <span className="ml-auto text-xs text-muted">全书 {total} 字</span>
        </div>

        <div className="grid min-h-0 min-w-0 flex-1 gap-2 p-2 lg:grid-cols-[240px_minmax(0,1fr)_280px]">
          <aside className="flex min-w-0 flex-col gap-2">
            <div className="flex min-h-0 flex-col">
              <label className="mb-1 text-xs" htmlFor="volume-name">
                篇名
              </label>
              <input
                id="volume-name"
                value={volume.name}
                readOnly={!canEdit}
                onChange={(e) => patchVolume(volume.id, volume.notes, e.target.value)}
                className="win-in mb-1 px-1 py-0.5"
              />
              <ul className="win-in max-h-36 overflow-auto">
                {orderedVolumes.map((item) => {
                  const selected = item.id === volume.id;
                  const count = item.notes.reduce((sum, n) => sum + n.body.length, 0);
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setVolumeId(item.id);
                          const first = [...item.notes].sort(byName)[0];
                          if (first) setActiveId(first.id);
                        }}
                        className={
                          "flex w-full items-baseline justify-between gap-2 px-2 py-1 text-left " +
                          (selected ? "bg-hilite text-hilite-fg" : "")
                        }
                      >
                        <span className="min-w-0 truncate">{item.name}</span>
                        <span className="shrink-0 text-xs">{count}字</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
            <div className="flex min-h-0 flex-1 flex-col">
              <p className="mb-1 text-xs">章节（按文件名排序）· 本篇 {volumeCount} 字</p>
              <ul className="win-in max-h-48 min-h-32 flex-1 overflow-auto lg:max-h-none">
                {chapters.map((note) => {
                  const selected = note.id === active.id;
                  return (
                    <li key={note.id}>
                      <button
                        type="button"
                        onClick={() => setActiveId(note.id)}
                        className={
                          "flex w-full items-baseline justify-between gap-2 px-2 py-1 text-left " +
                          (selected ? "bg-hilite text-hilite-fg" : "")
                        }
                      >
                        <span className="min-w-0 truncate">{note.name}</span>
                        <span className="shrink-0 text-xs">{note.body.length}字</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          </aside>

          <section className="flex min-h-[360px] min-w-0 flex-col">
            <div className="mb-1 flex min-w-0 items-center gap-2 text-xs">
              <label className="shrink-0" htmlFor="chapter-name">
                文件名
              </label>
              <input
                id="chapter-name"
                value={active.name}
                readOnly={!canEdit}
                onChange={(e) => updateActive({ name: e.target.value })}
                className="win-in min-w-0 flex-1 px-1 py-0.5"
              />
              <span className="shrink-0">{wordCount}字</span>
            </div>
            <textarea
              aria-label="章节正文"
              value={active.body}
              readOnly={!canEdit}
              onChange={(e) => updateActive({ body: e.target.value })}
              placeholder={canEdit ? "在这里写正文…" : "只能查看。用指定邮箱登录后才能修改。"}
              className="win-in min-h-72 flex-1 resize-none px-2 py-2 font-serif text-base leading-7"
            />
          </section>

          <section className="flex min-w-0 flex-col gap-2">
            <p className="text-xs">情节回顾</p>
            <div className="flex gap-1">
              {(
                [
                  ["one", "当前"],
                  ["volume", "本篇"],
                  ["all", "全书"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setScope(key)}
                  className={scope === key ? "win-btn win-btn-pressed flex-1" : "win-btn flex-1"}
                >
                  {label}
                </button>
              ))}
            </div>
            <textarea
              aria-label="回顾问题"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              rows={4}
              className="win-in px-2 py-1"
            />
            <button
              type="button"
              onClick={onAsk}
              disabled={busy || !question.trim()}
              className="win-btn font-bold disabled:opacity-50"
            >
              {busy ? "正在翻阅…" : "回顾情节"}
            </button>
            <div className="win-in min-h-28 flex-1 overflow-auto px-2 py-2 text-sm leading-relaxed whitespace-pre-wrap">
              {error ? (
                <p>{error}</p>
              ) : answer ? (
                answer
              ) : (
                <p className="text-muted">可以问当前文件、本篇或全书。回答只依据已写内容。</p>
              )}
            </div>
          </section>
        </div>

        <footer className="win-in mx-1 mb-1 flex justify-between gap-2 px-2 py-0.5 text-xs">
          <span className="min-w-0 truncate">
            {volume.name}　{active.name}
          </span>
          <span className="shrink-0">{wordCount} 字</span>
        </footer>
      </div>
    </main>
  );
}
