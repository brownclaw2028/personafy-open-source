import React, { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { Menu, X } from 'lucide-react';

interface LayoutProps {
  children: React.ReactNode;
  activeNav?: string;
  userName?: string;
  userInitials?: string;
  onNavClick?: (itemId: string) => void;
}

export function Layout({
  children,
  activeNav,
  userName,
  userInitials,
  onNavClick,
}: LayoutProps) {
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const wasOpenRef = useRef(false);
  const hamburgerRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const mainContentRef = useRef<HTMLDivElement>(null);

  // Reset scroll position when route changes
  useEffect(() => {
    mainContentRef.current?.scrollTo(0, 0);
  }, [location.pathname]);

  const handleNav = (id: string) => {
    setMobileOpen(false);
    onNavClick?.(id);
  };

  // Scroll lock + focus management when mobile sidebar is open
  useEffect(() => {
    const mainEl = mainContentRef.current;
    if (mobileOpen) {
      document.body.style.overflow = 'hidden';
      // Set main content (includes hamburger) as inert to trap focus inside sidebar dialog
      mainEl?.setAttribute('inert', '');
      // Auto-focus close button
      requestAnimationFrame(() => closeButtonRef.current?.focus());
    } else {
      document.body.style.overflow = '';
      mainEl?.removeAttribute('inert');
      // Only restore focus to hamburger when sidebar was previously open (not on initial mount)
      if (wasOpenRef.current) {
        hamburgerRef.current?.focus();
      }
    }
    wasOpenRef.current = mobileOpen;
    return () => {
      document.body.style.overflow = '';
      mainEl?.removeAttribute('inert');
    };
  }, [mobileOpen]);

  // Escape key closes sidebar
  useEffect(() => {
    if (!mobileOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [mobileOpen]);

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Skip-to-content link — visible on keyboard focus only */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-1/2 focus:-translate-x-1/2 focus:z-[70] focus:px-4 focus:py-2 focus:bg-primary focus:text-white focus:rounded-lg focus:text-sm focus:font-medium focus:shadow-glow focus:outline-none"
      >
        Skip to main content
      </a>

      {/* Desktop sidebar — hidden on mobile */}
      <div className="hidden md:block">
        <Sidebar
          activeItem={activeNav}
          userName={userName}
          userInitials={userInitials}
          onNavClick={onNavClick}
        />
      </div>

      {/* Mobile sidebar overlay */}
      {mobileOpen && (
        <>
          <div
            className="md:hidden fixed inset-0 bg-black/60 backdrop-blur-sm z-[45]"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Navigation menu"
            className="md:hidden fixed inset-y-0 left-0 z-50 animate-slide-in-right"
          >
            <div className="relative">
              <Sidebar
                activeItem={activeNav}
                userName={userName}
                userInitials={userInitials}
                onNavClick={handleNav}
              />
              <button
                ref={closeButtonRef}
                type="button"
                onClick={() => setMobileOpen(false)}
                aria-label="Close menu"
                className="absolute top-4 right-4 p-1 text-text-tertiary hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>
        </>
      )}

      {/* Main content wrapper — includes hamburger so both get inert when sidebar open */}
      <div ref={mainContentRef} className="flex-1 overflow-auto">
        {/* Mobile hamburger (fixed positioning, but inside mainContentRef for inert coverage) */}
        <button
          ref={hamburgerRef}
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label="Open menu"
          className="md:hidden fixed top-4 left-4 z-40 p-2 bg-card border border-card-border/50 rounded-lg text-white"
        >
          <Menu className="w-5 h-5" />
        </button>

        <Topbar userName={userName} userInitials={userInitials} onNavClick={onNavClick} />
        <div className="md:hidden h-14" /> {/* spacer for mobile hamburger */}
        <main id="main-content" tabIndex={-1} className="outline-none">
          {children}
        </main>
      </div>
    </div>
  );
}
