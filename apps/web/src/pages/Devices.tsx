import { useState, useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import { Layout } from '../components/Layout';
import { SkeletonPage } from '../components/LoadingSkeleton';
import { useNow } from '../lib/useNow';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { VaultErrorState } from '../components/VaultErrorState';
import { toast } from '../components/Toast';
import { ConfirmDialog } from '../components/ConfirmDialog';
import {
  Smartphone,
  Monitor,
  Plus,
  Trash2,
  RefreshCw,
  Shield,
  Wifi,
  WifiOff,
  Clock,
  QrCode,
  X,
  Copy,
  Check,
} from 'lucide-react';
import { useVault, type VaultDevice, type VaultData } from '../lib/VaultProvider';
import { useSupabaseSession } from '../lib/useSupabaseSession';
import { hasSupabaseConfig } from '../lib/supabase';
import { startPairing, checkPairingStatus, revokeDevice } from '../lib/cloudPairing';

interface DevicesProps {
  userName?: string;
  userInitials?: string;
  onNavClick?: (itemId: string) => void;
}

const typeConfig: Record<VaultDevice['type'], { icon: typeof Shield; label: string; color: string; bg: string }> = {
  vault: { icon: Shield, label: 'Vault Device', color: 'text-accent', bg: 'bg-accent/10' },
  agent: { icon: Monitor, label: 'Agent Device', color: 'text-primary', bg: 'bg-primary/10' },
  mobile: { icon: Smartphone, label: 'Mobile Device', color: 'text-yellow-400', bg: 'bg-yellow-400/10' },
};

const statusConfig: Record<VaultDevice['status'], { icon: typeof Wifi; label: string; color: string; dot: string }> = {
  connected: { icon: Wifi, label: 'Connected', color: 'text-accent', dot: 'bg-accent' },
  disconnected: { icon: WifiOff, label: 'Disconnected', color: 'text-text-tertiary', dot: 'bg-text-tertiary' },
  pairing: { icon: RefreshCw, label: 'Pairing…', color: 'text-yellow-400', dot: 'bg-yellow-400' },
};

export function Devices({ userName = 'User', userInitials = 'U', onNavClick }: DevicesProps) {
  useDocumentTitle('Devices');
  const { vault, loading, error, locked, refresh, unlock, save } = useVault();
  const { session } = useSupabaseSession();

  const [showPairing, setShowPairing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pairingCode, setPairingCode] = useState('');
  const [pairingDeviceId, setPairingDeviceId] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<VaultDevice | null>(null);
  const qrCanvasRef = useRef<HTMLCanvasElement>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clean up copy timer on unmount
  useEffect(() => {
    return () => { if (copyTimerRef.current) clearTimeout(copyTimerRef.current); };
  }, []);

  // Generate QR code when pairing code changes
  useEffect(() => {
    if (!pairingCode || !qrCanvasRef.current) return;
    QRCode.toCanvas(qrCanvasRef.current, pairingCode, {
      width: 180,
      margin: 2,
      color: { dark: '#0D1117', light: '#FFFFFF' },
    }).catch(() => {
      // Silently fail — the code is still shown as text below
    });
  }, [pairingCode]);

  const devices = vault?.devices ?? [];
  const isSafeRoom = vault?.privacyPosture === 'safe_room';
  const cloudSyncEnabled = Boolean(vault?.settings?.cloudSyncEnabled);
  const cloudPairingReady = cloudSyncEnabled && hasSupabaseConfig() && !!session;

  const connectedCount = devices.filter((d) => d.status === 'connected').length;

  if (loading || (!vault && !error && !locked)) {
    return (
      <Layout activeNav="devices" userName={userName} userInitials={userInitials} onNavClick={onNavClick}>
        <SkeletonPage cards={3} />
      </Layout>
    );
  }

  if (locked || (error && !vault)) {
    return (
      <Layout activeNav="devices" userName={userName} userInitials={userInitials} onNavClick={onNavClick}>
        <VaultErrorState error={error ?? 'Vault locked'} locked={locked} onUnlock={unlock} onRetry={refresh} />
      </Layout>
    );
  }

  const generatePairingCode = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const rng = crypto.getRandomValues(new Uint8Array(8));
    const seg = (offset: number, n: number) =>
      Array.from({ length: n }, (_, i) => chars[rng[offset + i] % chars.length]).join('');
    return `PFY-${seg(0, 4)}-${seg(4, 4)}`;
  };

  const updateVaultDevices = async (nextDevices: VaultDevice[]) => {
    if (!vault) return false;
    const updated: VaultData = { ...vault, devices: nextDevices };
    return await save(updated);
  };

  const openPairing = async () => {
    if (!vault) return;
    if (cloudSyncEnabled && !cloudPairingReady) {
      toast('Sign in to Supabase to start pairing.', 'error');
      return;
    }

    let code = generatePairingCode();
    let expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    if (cloudPairingReady) {
      const result = await startPairing('New Agent Device', 'agent');
      if (!result.ok) {
        toast(result.error, 'error');
        return;
      }
      code = result.code;
      expiresAt = result.expiresAt;
    }

    setPairingCode(code);
    setShowPairing(true);

    const id = `dev_${crypto.randomUUID().slice(0, 8)}`;
    setPairingDeviceId(id);

    const next: VaultDevice[] = [
      ...(vault.devices ?? []),
      {
        id,
        name: 'New Agent Device',
        type: 'agent',
        status: 'pairing',
        lastSeen: new Date().toISOString(),
        pairingCode: code,
        pairingExpiresAt: expiresAt,
      },
    ];

    const ok = await updateVaultDevices(next);
    if (!ok) toast('Failed to start pairing', 'error');
  };

  const removeDevice = async (deviceId: string) => {
    if (!vault) return;
    if (cloudPairingReady) {
      const result = await revokeDevice(deviceId);
      if (!result.ok) {
        toast(result.error, 'error');
        return;
      }
    }
    const ok = await updateVaultDevices((vault.devices ?? []).filter((d) => d.id !== deviceId));
    if (ok) toast('Device removed');
    else toast('Failed to remove device', 'error');
  };

  const simulateConnected = async () => {
    if (!vault || !pairingDeviceId) return;
    const next = (vault.devices ?? []).map((d) =>
      d.id === pairingDeviceId
        ? { ...d, status: 'connected' as const, lastSeen: new Date().toISOString(), pairingCode: undefined, pairingExpiresAt: undefined }
        : d,
    );
    const ok = await updateVaultDevices(next);
    if (ok) {
      toast('Pairing complete (simulated)');
      setShowPairing(false);
      setPairingDeviceId(null);
      setPairingCode('');
    } else {
      toast('Failed to complete pairing', 'error');
    }
  };

  const checkPairing = async () => {
    if (!vault || !pairingCode || !pairingDeviceId) return;
    if (!cloudPairingReady) {
      toast('Sign in to check pairing status.', 'error');
      return;
    }
    const result = await checkPairingStatus(pairingCode);
    if (!result.ok) {
      toast(result.error, 'error');
      return;
    }
    if (result.status === 'claimed' && result.deviceId) {
      const claimedDeviceId = result.deviceId;
      const next = (vault.devices ?? []).map((d) =>
        d.id === pairingDeviceId
          ? {
              ...d,
              id: claimedDeviceId,
              name: result.deviceName ?? d.name,
              type: (result.deviceType as VaultDevice['type']) ?? d.type,
              status: 'connected' as const,
              lastSeen: new Date().toISOString(),
              pairingCode: undefined,
              pairingExpiresAt: undefined,
            }
          : d,
      );
      const ok = await updateVaultDevices(next);
      if (ok) {
        toast('Device paired successfully.');
        setShowPairing(false);
        setPairingDeviceId(null);
        setPairingCode('');
        return;
      }
      toast('Failed to update local device list.', 'error');
      return;
    }
    toast(`Pairing is still ${result.status}.`);
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(pairingCode);
      setCopied(true);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      toast('Copy failed (clipboard may require HTTPS)', 'error');
    }
  };

  return (
    <Layout activeNav="devices" userName={userName} userInitials={userInitials} onNavClick={onNavClick}>
      <div className="p-8 max-w-5xl animate-fade-in">
        {/* Header */}
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-white mb-2">Devices</h1>
            <p className="text-text-secondary">
              Manage paired devices that can access your vault. Only paired devices can request context.
            </p>
          </div>
          <button
            onClick={() => void openPairing()}
            disabled={isSafeRoom}
            title={isSafeRoom ? 'Pairing disabled in Strict mode' : 'Pair a new device'}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              isSafeRoom
                ? 'bg-white/10 text-text-tertiary cursor-not-allowed'
                : 'bg-primary hover:bg-primary/90 text-white shadow-glow'
            }`}
          >
            <Plus className="w-4 h-4" />
            Pair Device
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          <div className="glass-card p-4">
            <div className="text-2xl font-bold text-white mb-0.5">{devices.length}</div>
            <div className="text-text-tertiary text-xs">Total Devices</div>
          </div>
          <div className="glass-card p-4">
            <div className="text-2xl font-bold text-accent mb-0.5">{connectedCount}</div>
            <div className="text-text-tertiary text-xs">Connected</div>
          </div>
          <div className="glass-card p-4">
            <div className="text-2xl font-bold text-primary mb-0.5">
              {vault?.privacyPosture === 'safe_room' ? 'Locked' : 'Open'}
            </div>
            <div className="text-text-tertiary text-xs">Pairing Mode</div>
          </div>
        </div>

        {/* Security Info */}
        <div className="glass-card p-4 mb-6 border-accent/20 flex items-start gap-3">
          <Shield className="w-5 h-5 text-accent flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-text-secondary text-sm">
              Scan a QR code or enter a pairing code to <strong className="text-white">securely connect</strong> a new device.
              Each device gets its own encrypted channel — the vault never shares your master key.
            </p>
            <p className="text-text-tertiary text-xs mt-1">
              In "Strict" mode, new device pairing is disabled.
            </p>
          </div>
        </div>

        {/* Device List */}
        <div className="space-y-3 stagger-children">
          {devices.map((device) => (
            <DeviceCard
              key={device.id}
              device={device}
              onRemove={() => setConfirmRemove(device)}
            />
          ))}
        </div>

        {/* Empty State */}
        {devices.length === 0 && (
          <div className="glass-card p-12 text-center mt-6">
            <Smartphone className="w-12 h-12 text-text-tertiary mx-auto mb-4" />
            <h3 className="text-white font-medium mb-2">No devices paired</h3>
            <p className="text-text-tertiary text-sm mb-4">
              Pair an agent device to start using your vault for context requests.
            </p>
            <button
              onClick={() => void openPairing()}
              disabled={isSafeRoom}
              className="text-sm text-accent hover:text-accent/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Pair your first device →
            </button>
          </div>
        )}

        {/* Pairing Modal */}
        {showPairing && (
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
            onClick={() => setShowPairing(false)}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="pair-device-title"
              className="glass-card p-8 w-full max-w-md relative text-center"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={() => setShowPairing(false)}
                aria-label="Close"
                className="absolute top-4 right-4 text-text-tertiary hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="w-16 h-16 bg-gradient-primary rounded-2xl flex items-center justify-center mx-auto mb-6">
                <QrCode className="w-8 h-8 text-white" />
              </div>

              <h2 id="pair-device-title" className="text-xl font-bold text-white mb-2">Pair a New Device</h2>
              <p className="text-text-secondary text-sm mb-6">
                Scan the QR code or enter the pairing code on your agent device.
              </p>

              {/* QR Code */}
              <div className="w-48 h-48 mx-auto mb-6 bg-white rounded-xl flex items-center justify-center p-2">
                <canvas ref={qrCanvasRef} aria-label={`QR code for pairing code ${pairingCode}`} />
              </div>

              {/* Pairing Code */}
              <div className="mb-6">
                <p className="text-text-tertiary text-xs uppercase tracking-wider mb-2">Or enter this code</p>
                <div className="flex items-center justify-center gap-3">
                  <code className="text-2xl font-bold text-white tracking-widest font-mono">{pairingCode}</code>
                  <button
                    onClick={() => void handleCopy()}
                    className="p-2 rounded-lg bg-card border border-card-border/50 text-text-tertiary hover:text-accent hover:border-accent/40 transition-colors"
                    aria-label="Copy pairing code"
                  >
                    {copied ? <Check className="w-4 h-4 text-accent" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Steps */}
              <div className="text-left space-y-3 mb-6">
                <Step num={1} text="Open OpenClaw on the agent device" />
                <Step num={2} text={`Run: /personafy pair ${pairingCode}`} />
                <Step num={3} text="Scan QR code or enter pairing code" />
                <Step num={4} text="Approve the connection on this device" />
              </div>

              {cloudPairingReady && (
                <button
                  onClick={() => void checkPairing()}
                  className="w-full px-4 py-2.5 bg-card border border-card-border/50 rounded-xl text-text-secondary hover:text-white hover:border-accent/40 text-sm font-medium transition-colors mb-3"
                >
                  Check pairing status
                </button>
              )}

              {/* Dev-only simulation */}
              {import.meta.env.DEV && pairingDeviceId && (
                <button
                  onClick={() => void simulateConnected()}
                  className="w-full px-4 py-2.5 bg-primary/10 border border-primary/30 rounded-xl text-primary hover:bg-primary/20 text-sm font-medium transition-colors"
                >
                  Simulate Connected
                </button>
              )}

              <p className="text-text-tertiary text-xs mt-4">
                Code expires in 10 minutes. Pairing completes when the agent claims the code.
              </p>
            </div>
          </div>
        )}

        <ConfirmDialog
          open={!!confirmRemove}
          title="Remove device?"
          message={confirmRemove ? `This will unpair “${confirmRemove.name}”. It will no longer be able to request context.` : ''}
          confirmLabel="Remove"
          cancelLabel="Cancel"
          variant="danger"
          onCancel={() => setConfirmRemove(null)}
          onConfirm={() => {
            const d = confirmRemove;
            setConfirmRemove(null);
            if (d) void removeDevice(d.id);
          }}
        />
      </div>
    </Layout>
  );
}

function DeviceCard({ device, onRemove }: { device: VaultDevice; onRemove: () => void }) {
  const type = typeConfig[device.type];
  const status = statusConfig[device.status];
  const TypeIcon = type.icon;

  const now = useNow(60_000);

  const lastSeen = new Date(device.lastSeen);
  const minsAgo = Math.floor((now - lastSeen.getTime()) / 60000);
  const timeStr = minsAgo < 1 ? 'Just now' : minsAgo < 60 ? `${minsAgo}m ago` : `${Math.floor(minsAgo / 60)}h ago`;

  const pairingExpiresAt = device.pairingExpiresAt ? new Date(device.pairingExpiresAt) : null;
  const pairingExpired = pairingExpiresAt ? pairingExpiresAt.getTime() < now : false;
  const pairingMinsLeft = pairingExpiresAt ? Math.ceil((pairingExpiresAt.getTime() - now) / 60000) : null;

  const canRemove = device.type !== 'vault';

  return (
    <div className={`glass-card p-5 hover:border-accent/20 transition-all duration-200 ${device.status === 'pairing' ? 'border-yellow-400/10' : ''}`}>
      <div className="flex items-center gap-4">
        <div className={`w-12 h-12 ${type.bg} rounded-xl flex items-center justify-center flex-shrink-0`}>
          <TypeIcon className={`w-6 h-6 ${type.color}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-1">
            <span className="text-white font-semibold">{device.name}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full ${type.bg} ${type.color} font-medium`}>
              {type.label}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-text-tertiary">
            <div className="flex items-center gap-1.5">
              <div className={`w-2 h-2 rounded-full ${status.dot} ${device.status === 'connected' ? 'animate-pulse' : ''}`} />
              <span className={status.color}>{status.label}</span>
            </div>
            {device.ip && <span className="font-mono text-xs">{device.ip}</span>}
            <div className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              <span>{timeStr}</span>
            </div>
            {device.version && <span>{device.version}</span>}

            {device.status === 'pairing' && device.pairingCode && (
              <span className="font-mono text-xs text-yellow-400/80">
                {device.pairingCode}{' '}
                {pairingMinsLeft != null && (
                  <span className={pairingExpired ? 'text-red-400' : ''}>
                    ({pairingExpired ? 'expired' : `${pairingMinsLeft}m left`})
                  </span>
                )}
              </span>
            )}
          </div>
        </div>

        <button
          onClick={() => (canRemove ? onRemove() : toast('Vault device cannot be removed from the web UI yet.', 'info'))}
          className={`flex-shrink-0 transition-colors p-2 ${
            canRemove ? 'text-text-tertiary hover:text-red-400' : 'text-text-tertiary/50 cursor-not-allowed'
          }`}
          title={canRemove ? 'Remove device' : 'Cannot remove vault device'}
          disabled={!canRemove}
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

function Step({ num, text }: { num: number; text: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
        <span className="text-primary text-xs font-bold">{num}</span>
      </div>
      <span className="text-text-secondary text-sm">{text}</span>
    </div>
  );
}
