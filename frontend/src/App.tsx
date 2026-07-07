import { useEffect, useRef, useState } from 'react'
import { Check, ChevronLeft, Loader2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot } from '@/components/ui/input-otp'
import { cn } from '@/lib/utils'

type Screen = 'username' | 'linking' | 'otp' | 'success'
// Which real endpoint the OTP screen submits to — set when we learn,
// from the /enroll response, whether this username is new or existing.
type AuthAction = 'confirm' | 'login'
type BtnState = 'idle' | 'loading' | 'success' | 'error'

// Full-width button that morphs between its label and a state icon via
// opacity/scale, so there's no layout jump when the request resolves.
function ActionButton({
  btnState,
  label,
  onClick,
  disabled = false,
}: {
  btnState: BtnState
  label: string
  onClick: () => void
  disabled?: boolean
}) {
  const isIdle = btnState === 'idle'
  return (
    <Button
      onClick={isIdle ? onClick : undefined}
      disabled={disabled || btnState === 'loading'}
      variant={btnState === 'error' ? 'destructive' : 'default'}
      className={cn(
        'relative h-12 w-full rounded-xl text-[15px] font-semibold transition-colors duration-200',
        btnState === 'success' && 'bg-emerald-600 text-white hover:bg-emerald-600',
      )}
    >
      <span className={cn('transition-opacity duration-150', !isIdle && 'opacity-0')}>{label}</span>
      <span
        className={cn(
          'absolute inset-0 flex items-center justify-center transition-opacity duration-150',
          isIdle && 'opacity-0',
        )}
      >
        {btnState === 'loading' && <Loader2 className="h-4 w-4 animate-spin" />}
        {btnState === 'success' && <Check className="h-4 w-4" />}
        {btnState === 'error' && <X className="h-4 w-4" />}
      </span>
    </Button>
  )
}

// Extracts the base32 secret from an otpauth:// URI for the "manual entry" copy button.
function extractSecret(uri: string): string {
  try {
    return new URL(uri).searchParams.get('secret') ?? ''
  } catch (err) {
    console.error('[extractSecret] failed to parse uri:', err)
    return ''
  }
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('username')
  const [authAction, setAuthAction] = useState<AuthAction>('login')

  const [username, setUsername] = useState('')
  const [usernameHint, setUsernameHint] = useState('')
  const [continueLoading, setContinueLoading] = useState(false)

  const [qr, setQr] = useState('')
  const [secret, setSecret] = useState('')
  // Username the cached qr/secret above belongs to — lets us tell "still
  // mid-enrollment for this account" apart from "a different account".
  const [linkedUsername, setLinkedUsername] = useState('')
  const [copied, setCopied] = useState(false)
  const copyTimeout = useRef<ReturnType<typeof setTimeout>>(undefined)

  const [code, setCode] = useState('')
  const [otpHint, setOtpHint] = useState('')
  const [verifyState, setVerifyState] = useState<BtnState>('idle')
  const [attemptsRemaining, setAttemptsRemaining] = useState<number | null>(null)
  const [retryAfter, setRetryAfter] = useState<number | null>(null)

  const [successMsg, setSuccessMsg] = useState('')

  // Bumping these forces the wrapping div to remount (via `key`), which
  // replays the shake keyframes even for the same error twice in a row.
  const [shake, setShake] = useState({ username: 0, otp: 0 })
  function triggerShake(target: 'username' | 'otp') {
    setShake(s => ({ ...s, [target]: s[target] + 1 }))
  }

  useEffect(() => {
    if (!retryAfter) return
    const id = setInterval(() => setRetryAfter(s => (s && s > 1 ? s - 1 : null)), 1000)
    return () => clearInterval(id)
  }, [retryAfter])

  const locked = Boolean(retryAfter)

  function resetOtp() {
    setCode('')
    setOtpHint('')
    setVerifyState('idle')
    setAttemptsRemaining(null)
    setRetryAfter(null)
  }

  function goBack() {
    setScreen('username')
    resetOtp()
  }

  function fullReset() {
    setScreen('username')
    setUsername('')
    setUsernameHint('')
    setQr('')
    setSecret('')
    setLinkedUsername('')
    setSuccessMsg('')
    resetOtp()
  }

  // The backend has no "does this username exist" endpoint, so we learn it
  // from /enroll itself: 201 means brand new (go scan a QR), 409 means the
  // row already exists. A 409 doesn't say whether that row is confirmed —
  // if it's the same username we just linked this session, it's still
  // mid-enrollment, so send them back to the QR screen rather than to a
  // login they can never pass (enroll/confirm never got called).
  async function handleContinue() {
    const name = username.trim()
    if (!name) {
      setUsernameHint('Enter a username to continue.')
      triggerShake('username')
      return
    }
    setUsernameHint('')
    setContinueLoading(true)
    try {
      const res = await fetch('/enroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: name }),
      })
      const data = await res.json()
      if (res.status === 201) {
        setQr(data.qr)
        setSecret(extractSecret(data.uri))
        setLinkedUsername(name)
        setAuthAction('confirm')
        setScreen('linking')
        return
      }
      if (res.status === 409) {
        if (linkedUsername === name && qr) {
          setAuthAction('confirm')
          setScreen('linking')
        } else {
          setAuthAction('login')
          setScreen('otp')
        }
        return
      }
      setUsernameHint(data.error ?? 'Something went wrong.')
      triggerShake('username')
    } catch (err) {
      console.error('[enroll] request failed:', err)
      setUsernameHint('Could not reach the server.')
      triggerShake('username')
    } finally {
      setContinueLoading(false)
    }
  }

  function copySecret() {
    navigator.clipboard
      .writeText(secret)
      .catch(err => console.error('[copySecret] clipboard write failed:', err))
    setCopied(true)
    clearTimeout(copyTimeout.current)
    copyTimeout.current = setTimeout(() => setCopied(false), 1500)
  }

  function handleLinkContinue() {
    resetOtp()
    setScreen('otp')
  }

  async function handleVerify() {
    if (verifyState !== 'idle' || locked) return
    if (code.length < 6) {
      setOtpHint('Enter all 6 digits.')
      triggerShake('otp')
      return
    }
    setOtpHint('')
    setAttemptsRemaining(null)
    setVerifyState('loading')

    const endpoint = authAction === 'confirm' ? '/enroll/confirm' : '/login/verify'
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, code }),
      })
      const data = await res.json()

      if (res.status === 429) {
        setRetryAfter(data.retryAfter)
        setOtpHint('Too many attempts.')
        setVerifyState('idle')
        triggerShake('otp')
        return
      }
      if (!res.ok) {
        setOtpHint(data.error ?? 'Verification failed.')
        if (typeof data.attemptsRemaining === 'number') setAttemptsRemaining(data.attemptsRemaining)
        setVerifyState('idle')
        setCode('')
        triggerShake('otp')
        return
      }

      setVerifyState('success')
      setSuccessMsg(
        authAction === 'confirm'
          ? `${username} is enrolled.`
          : `Welcome back, ${username}.`,
      )
      if (authAction === 'confirm') {
        // Now confirmed — the cached QR/secret are stale; a later 409 for
        // this username should be treated as a normal login.
        setQr('')
        setSecret('')
        setLinkedUsername('')
      }
      setTimeout(() => setScreen('success'), 900)
    } catch (err) {
      console.error(`[${endpoint}] request failed:`, err)
      setOtpHint('Could not reach the server.')
      setVerifyState('idle')
      triggerShake('otp')
    }
  }

  const showBack = screen === 'linking' || screen === 'otp'

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm">
        <Card className="rounded-[22px] py-0 ring-foreground/10">
          <CardContent className="px-6 py-7">
            {showBack && (
              <button
                onClick={goBack}
                className="-ml-1 mb-4 flex items-center gap-0.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                <ChevronLeft className="h-4 w-4" /> Back
              </button>
            )}

            {screen === 'username' && (
              <div key="username" className="animate-in fade-in slide-in-from-bottom-2 duration-300">
                <h1 className="text-xl font-semibold tracking-tight">Sign in</h1>
                <p className="mt-1 text-sm text-muted-foreground">Enter your username to continue.</p>

                <div key={`u-${shake.username}`} className={cn('mt-5', shake.username > 0 && 'animate-shake')}>
                  <Input
                    placeholder="Username"
                    value={username}
                    onChange={e => setUsername(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleContinue()}
                    maxLength={20}
                    autoComplete="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    autoFocus
                    className="h-12 rounded-xl px-4 text-base"
                  />
                </div>
                <div className="mb-4 min-h-[17px] pl-0.5 text-xs text-destructive">{usernameHint}</div>

                <ActionButton
                  btnState={continueLoading ? 'loading' : 'idle'}
                  label="Continue"
                  onClick={handleContinue}
                />
              </div>
            )}

            {screen === 'linking' && (
              <div key="linking" className="animate-in fade-in slide-in-from-bottom-2 text-center duration-300">
                <h1 className="text-xl font-semibold tracking-tight">Set up authenticator</h1>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                  No account for <b className="font-semibold text-foreground">{username}</b> yet.
                  <br />
                  Scan this with your authenticator app.
                </p>

                {qr && (
                  <div className="mx-auto my-5 w-fit rounded-2xl bg-white p-3">
                    <img src={qr} alt="Scan with your authenticator app" className="h-44 w-44" />
                  </div>
                )}

                {secret && (
                  <button
                    onClick={copySecret}
                    className="relative mx-auto grid w-fit place-items-center rounded-lg border border-border bg-white/[0.03] px-3 py-2 font-mono text-[12.5px] tracking-wide text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <span
                      className={cn(
                        'col-start-1 row-start-1 transition-all duration-200 ease-out',
                        copied && 'scale-95 opacity-0',
                      )}
                    >
                      {secret}
                    </span>
                    <span
                      className={cn(
                        'col-start-1 row-start-1 flex items-center gap-1.5 text-emerald-500 transition-all duration-200 ease-out',
                        !copied && 'scale-95 opacity-0',
                      )}
                    >
                      <Check className="h-3.5 w-3.5" strokeWidth={2.5} /> Copied
                    </span>
                  </button>
                )}

                <div className="mb-1 mt-5 flex flex-col gap-2.5 text-left">
                  <Step n={1}>Open Google Authenticator, Authy, or 1Password.</Step>
                  <Step n={2}>Scan the code, then enter the 6-digit code it shows.</Step>
                </div>

                <Button onClick={handleLinkContinue} className="mt-4 h-12 w-full rounded-xl text-[15px] font-semibold">
                  Done
                </Button>
              </div>
            )}

            {screen === 'otp' && (
              <div key="otp" className="animate-in fade-in slide-in-from-bottom-2 text-center duration-300">
                <h1 className="text-xl font-semibold tracking-tight">Enter your code</h1>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                  Open your authenticator app and enter the
                  <br />
                  6-digit code for <b className="font-semibold text-foreground">{username}</b>.
                </p>

                <div key={`o-${shake.otp}`} className={cn('mt-6 flex justify-center', shake.otp > 0 && 'animate-shake')}>
                  <InputOTP
                    maxLength={6}
                    value={code}
                    onChange={setCode}
                    onComplete={handleVerify}
                    disabled={locked}
                    autoFocus
                  >
                    <InputOTPGroup>
                      <InputOTPSlot index={0} className="h-14 w-12 text-xl font-semibold" />
                      <InputOTPSlot index={1} className="h-14 w-12 text-xl font-semibold" />
                      <InputOTPSlot index={2} className="h-14 w-12 text-xl font-semibold" />
                    </InputOTPGroup>
                    <InputOTPSeparator />
                    <InputOTPGroup>
                      <InputOTPSlot index={3} className="h-14 w-12 text-xl font-semibold" />
                      <InputOTPSlot index={4} className="h-14 w-12 text-xl font-semibold" />
                      <InputOTPSlot index={5} className="h-14 w-12 text-xl font-semibold" />
                    </InputOTPGroup>
                  </InputOTP>
                </div>

                <div className="mb-1 mt-2.5 min-h-[17px] text-xs text-destructive">
                  {otpHint}
                  {locked && retryAfter && <span className="ml-1 font-mono">{retryAfter}s</span>}
                </div>
                {!locked && attemptsRemaining !== null && (
                  <p className="mb-1 text-xs text-muted-foreground">
                    {attemptsRemaining === 0
                      ? 'Next failure locks the account for 5 minutes.'
                      : `${attemptsRemaining} attempt${attemptsRemaining !== 1 ? 's' : ''} remaining.`}
                  </p>
                )}

                <ActionButton
                  btnState={otpHint && verifyState === 'idle' ? 'error' : verifyState}
                  label="Verify"
                  onClick={handleVerify}
                  disabled={locked}
                />
              </div>
            )}

            {screen === 'success' && (
              <div key="success" className="py-1 text-center">
                <div className="mx-auto mb-5 flex h-[78px] w-[78px] animate-in items-center justify-center rounded-full bg-emerald-500/15 zoom-in-50 duration-500">
                  <Check className="h-9 w-9 text-emerald-500" strokeWidth={2.5} />
                </div>
                <h1 className="animate-in text-xl font-semibold tracking-tight fade-in slide-in-from-bottom-1 duration-300">
                  {authAction === 'confirm' ? "You're enrolled" : 'Signed in'}
                </h1>
                <p className="mt-1.5 animate-in text-sm text-muted-foreground fade-in slide-in-from-bottom-1 delay-75 duration-300">
                  {successMsg}
                </p>

                <Button variant="outline" onClick={fullReset} className="mt-6 h-11 w-full rounded-xl font-medium">
                  Sign out
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
        <p className="mt-4 text-center text-[11.5px] tracking-wide text-muted-foreground/70">
          Time-based one-time password · demo
        </p>
      </div>
    </div>
  )
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="flex h-[21px] w-[21px] flex-none items-center justify-center rounded-full border border-border text-[11px] font-semibold text-muted-foreground">
        {n}
      </span>
      <span className="text-[13.5px] leading-relaxed text-muted-foreground">{children}</span>
    </div>
  )
}
