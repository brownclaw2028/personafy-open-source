import { useLocation } from 'react-router-dom';
import {
  Home,
  Users,
  CheckCircle,
  Shield,
  FileText,
  Smartphone,
  Database,
  BookOpen,
  Settings,
  Play,
  type LucideIcon,
} from 'lucide-react';
import { useVault } from '../lib/VaultProvider';

interface NavItem {
  id: string;
  path: string;
  name: string;
  icon: LucideIcon;
}

interface SidebarProps {
  activeItem?: string;
  userName?: string;
  userInitials?: string;
  onNavClick?: (itemId: string) => void;
}

const navItems: NavItem[] = [
  { id: 'home', path: '/', name: 'Home', icon: Home },
  { id: 'personas', path: '/personas', name: 'Personas', icon: Users },
  { id: 'approvals', path: '/approvals', name: 'Approvals', icon: CheckCircle },
  { id: 'rules', path: '/rules', name: 'Rules', icon: Shield },
  { id: 'audit', path: '/audit', name: 'Audit Log', icon: FileText },
  { id: 'devices', path: '/devices', name: 'Devices', icon: Smartphone },
  { id: 'sources', path: '/sources', name: 'Sources', icon: Database },
  { id: 'data-browser', path: '/browse', name: 'Data Browser', icon: BookOpen },
  { id: 'demo', path: '/demo', name: 'Interactive Demo', icon: Play },
  { id: 'settings', path: '/settings', name: 'Settings', icon: Settings },
];

export function Sidebar({
  activeItem,
  userName = 'User',
  userInitials = 'U',
  onNavClick,
}: SidebarProps) {
  const location = useLocation();
  const { vault, recentApprovalCount } = useVault();
  const postureLabels: Record<string, string> = {
    simple_lock: 'Relaxed',
    alarm_system: 'Balanced',
    safe_room: 'Strict',
  };
  const postureName = vault?.privacyPosture
    ? postureLabels[vault.privacyPosture] ?? vault.privacyPosture
    : 'Not Set';
  // Use centralized approval count from VaultProvider (ticks every 60s there)
  const approvalCount = recentApprovalCount;
  const ruleCount = vault?.rules?.filter(r => r.enabled).length ?? 0;

  const getIsActive = (item: NavItem) => {
    if (activeItem) return activeItem === item.id;
    if (item.path === '/') return location.pathname === '/';
    return location.pathname.startsWith(item.path);
  };

  return (
    <div className="w-64 h-screen bg-black/60 border-r border-card-border/50 flex flex-col relative">
      {/* Logo */}
      <div className="p-6 border-b border-card-border/50">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-gradient-primary rounded-lg flex items-center justify-center">
            <Shield className="w-5 h-5 text-white" />
          </div>
          <span className="text-xl font-bold text-white">Personafy</span>
        </div>
      </div>

      {/* Navigation */}
      <div className="flex-1 py-6">
        <nav className="space-y-1 px-4">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = getIsActive(item);
            const isComingSoon = false; // All pages now built

            return (
              <button
                key={item.id}
                onClick={() => !isComingSoon && onNavClick?.(item.id)}
                disabled={isComingSoon}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all duration-200 group relative ${
                  isActive
                    ? 'bg-primary text-white shadow-glow'
                    : isComingSoon
                    ? 'text-text-tertiary/40 cursor-not-allowed'
                    : 'text-text-secondary hover:text-white hover:bg-white/10'
                }`}
              >
                <Icon
                  className={`w-5 h-5 ${
                    isActive
                      ? 'text-white'
                      : isComingSoon
                      ? 'text-text-tertiary/30'
                      : 'text-text-tertiary group-hover:text-accent'
                  }`}
                />
                <span className="font-medium">{item.name}</span>
                {/* Badge for recent approvals count */}
                {item.id === 'approvals' && approvalCount > 0 && (
                  <span
                    aria-label={`${approvalCount} recent approval${approvalCount !== 1 ? 's' : ''}`}
                    className="ml-auto min-w-[20px] h-5 px-1.5 flex items-center justify-center text-[10px] font-bold text-white bg-accent rounded-full"
                  >
                    {approvalCount}
                  </span>
                )}
                {/* Badge for active rules count */}
                {item.id === 'rules' && ruleCount > 0 && !isActive && (
                  <span
                    aria-label={`${ruleCount} active rule${ruleCount !== 1 ? 's' : ''}`}
                    className="ml-auto min-w-[20px] h-5 px-1.5 flex items-center justify-center text-[10px] font-medium text-text-tertiary bg-white/10 rounded-full"
                  >
                    {ruleCount}
                  </span>
                )}
                {isComingSoon && (
                  <span className="ml-auto text-[10px] text-text-tertiary/40 uppercase tracking-wider">
                    Soon
                  </span>
                )}
              </button>
            );
          })}
        </nav>

      </div>

      {/* Vault Status Indicator */}
      <div className="px-4 pb-2">
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-accent/5 border border-accent/10">
          <div className="w-2 h-2 rounded-full bg-accent animate-pulse" />
          <span className="text-accent text-xs font-medium">Vault Active</span>
          <span className="text-text-tertiary text-[10px] ml-auto">{postureName}</span>
        </div>
      </div>

      {/* User Profile */}
      <div className="p-4 border-t border-card-border/50">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-primary rounded-full flex items-center justify-center text-white font-semibold">
            {userInitials}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white font-medium truncate">{userName}</p>
            <p className="text-text-tertiary text-xs">Personal Account</p>
          </div>
        </div>
      </div>
    </div>
  );
}
