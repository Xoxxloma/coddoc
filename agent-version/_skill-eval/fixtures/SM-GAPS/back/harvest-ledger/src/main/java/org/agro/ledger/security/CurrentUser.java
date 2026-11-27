package org.agro.ledger.security;

import org.springframework.security.core.context.SecurityContextHolder;

public final class CurrentUser {
  private CurrentUser() {}

  public static String number() {
    return (String) SecurityContextHolder.getContext().getAuthentication().getPrincipal();
  }

  public static boolean has(LedgerRole role) {
    return SecurityContextHolder.getContext().getAuthentication().getAuthorities().stream()
        .anyMatch(a -> a.getAuthority().equals("ROLE_" + role.name()));
  }
}
