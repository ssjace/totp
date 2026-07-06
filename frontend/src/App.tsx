import { useState, useEffect } from 'react'
import { Check, Loader2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot } from '@/components/ui/input-otp'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

type Mode = 'signup' | 'login'
type Step = 'start' | 'qr'
type BtnState = 'idle' | 'loading' | 'success' | 'error'

// Full-width button that fades between label and state icon.
// The label and icon are both always in the DOM; opacity transitions
// between them so there's no layout jump.
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
        'w-full relative transition-colors duration-200',
        btnState === 'success' && 'bg-emerald-600 hover:bg-emerald-600 border-emerald-600 text-white',
      )}
    >
      <span className={cn('transition-opacity duration-150', !isIdle && 'opacity-0')}>
        {label}
      </span>
      <span className={cn(
        'absolute inset-0 flex items-center justify-center transition-opacity duration-150',
        isIdle && 'opacity-0',
      )}>
        {btnState === 'loading' && <Loader2 className="h-4 w-4 animate-spin" />}
        {btnState === 'success' && <Check className="h-4 w-4" />}
        {btnState === 'error'   && <X className="h-4 w-4" />}
      </span>
    </Button>
  )
}

export default function App() {
  const [mode, setMode]       = useState<Mode>('signup')
  const [step, setStep]       = useState<Step>('start')
  const [username, setUsername] = useState('')
  const [code, setCode]       = useState('')
  const [qr, setQr]           = useState('')
  const [btnState, setBtnState] = useState<BtnState>('idle')
  const [error, setError]     = useState('')
  const [successMsg, setSuccessMsg] = useState('')
  const [attemptsRemaining, setAttemptsRemaining] = useState<number | null>(null)
  const [retryAfter, setRetryAfter] = useState<number | null>(null)

  useEffect(() => {
    if (!retryAfter) return
    const id = setInterval(() => setRetryAfter(s => (s && s > 1 ? s - 1 : null)), 1000)
    return () => clearInterval(id)
  }, [retryAfter])

  function flash(state: 'success' | 'error') {
    setBtnState(state)
    setTimeout(() => setBtnState('idle'), state === 'success' ? 1600 : 900)
  }

  function clearFeedback() {
    setError('')
    setSuccessMsg('')
    setAttemptsRemaining(null)
  }

  function switchMode() {
    if (step === 'qr') { setStep('start'); setQr(''); setCode('') }
    setMode(m => m === 'signup' ? 'login' : 'signup')
    clearFeedback()
    setRetryAfter(null)
  }

  async function handleSubmit() {
    clearFeedback()
    setBtnState('loading')

    try {
      if (mode === 'signup' && step === 'start') {
        const res = await fetch('/enroll', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username }),
        })
        const data = await res.json()
        if (!res.ok) { setError(data.error); flash('error'); return }
        setQr(data.qr)
        setStep('qr')
        setBtnState('idle')
        return
      }

      if (mode === 'signup' && step === 'qr') {
        const res = await fetch('/enroll/confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, code }),
        })
        const data = await res.json()
        if (!res.ok) { setError(data.error); flash('error'); return }
        flash('success')
        setSuccessMsg(`${username} enrolled — you can now log in.`)
        setTimeout(() => { setStep('start'); setCode(''); setQr(''); setSuccessMsg('') }, 2200)
        return
      }

      // login
      const res = await fetch('/login/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, code }),
      })
      const data = await res.json()
      if (res.status === 429) {
        setRetryAfter(data.retryAfter)
        setError('Too many attempts.')
        flash('error')
        return
      }
      if (!res.ok) {
        setError(data.error)
        if (typeof data.attemptsRemaining === 'number') setAttemptsRemaining(data.attemptsRemaining)
        flash('error')
        return
      }
      flash('success')
      setSuccessMsg(`Welcome back, ${username}.`)
    } catch {
      setError('Could not reach the server.')
      flash('error')
    }
  }

  const locked = Boolean(retryAfter)
  const showCode = mode === 'login' || step === 'qr'
  const showQr   = step === 'qr'

  const primaryLabel =
    mode === 'login'              ? 'Log in'  :
    step  === 'qr'                ? 'Confirm' : 'Sign up'

  const modeLink =
    mode === 'signup'
      ? { text: 'Already enrolled?', action: 'Log in' }
      : { text: 'New here?',         action: 'Sign up' }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="w-full max-w-sm flex flex-col gap-5">

        <div>
          <h1 className="text-2xl font-semibold tracking-tight">TOTP Demo</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Time-based one-time password authentication.
          </p>
        </div>

        <div className="bg-card border border-border rounded-xl p-6 flex flex-col gap-4">
          <div className="flex flex-col gap-4">
            <Input
              placeholder="Username"
              value={username}
              onChange={e => setUsername(e.target.value)}
              disabled={step === 'qr'}
              autoFocus
            />
            {showQr && qr && (
              <img src={qr} alt="Scan with your authenticator app" className="w-full rounded-lg" />
            )}
            {showCode && (
              <div className="flex justify-center">
                <InputOTP
                  maxLength={6}
                  value={code}
                  onChange={setCode}
                  onComplete={handleSubmit}
                >
                  <InputOTPGroup>
                    <InputOTPSlot index={0} />
                    <InputOTPSlot index={1} />
                    <InputOTPSlot index={2} />
                  </InputOTPGroup>
                  <InputOTPSeparator />
                  <InputOTPGroup>
                    <InputOTPSlot index={3} />
                    <InputOTPSlot index={4} />
                    <InputOTPSlot index={5} />
                  </InputOTPGroup>
                </InputOTP>
              </div>
            )}
          </div>

          <ActionButton
            btnState={btnState}
            label={primaryLabel}
            onClick={handleSubmit}
            disabled={locked}
          />

          {/* Mode switch */}
          {step === 'start' && (
            <p className="text-xs text-muted-foreground text-center">
              {modeLink.text}{' '}
              <button
                onClick={switchMode}
                className="underline underline-offset-2 hover:text-foreground transition-colors"
              >
                {modeLink.action}
              </button>
            </p>
          )}
          {step === 'qr' && (
            <button
              onClick={() => { setStep('start'); setQr(''); setCode(''); clearFeedback() }}
              className="text-xs text-muted-foreground text-center hover:text-foreground transition-colors"
            >
              ← Back
            </button>
          )}

          {/* Feedback */}
          {error && (
            <p className="text-sm text-destructive">
              {error}
              {locked && retryAfter && (
                <span className="ml-1 font-mono shimmer shimmer-duration-3000">{retryAfter}s</span>
              )}
            </p>
          )}
          {successMsg && (
            <p className="shimmer shimmer-once shimmer-duration-1500 text-sm text-muted-foreground">
              {successMsg}
            </p>
          )}
          {!locked && attemptsRemaining !== null && (
            <p className="text-xs text-muted-foreground">
              {attemptsRemaining === 0
                ? 'Next failure locks the account for 5 minutes.'
                : `${attemptsRemaining} attempt${attemptsRemaining !== 1 ? 's' : ''} remaining.`}
            </p>
          )}

        </div>
      </div>
    </div>
  )
}
