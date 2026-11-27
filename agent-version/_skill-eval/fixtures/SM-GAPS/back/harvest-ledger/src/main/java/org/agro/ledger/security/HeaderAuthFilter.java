package org.agro.ledger.security;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.Arrays;
import java.util.List;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
public class HeaderAuthFilter extends OncePerRequestFilter {

  static final String NUMBER_HEADER = "X-Employee-Number";
  static final String ROLES_HEADER = "X-Employee-Roles";

  @Override
  protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
      throws ServletException, IOException {
    String number = request.getHeader(NUMBER_HEADER);
    if (number == null || number.isBlank()) {
      response.sendError(HttpServletResponse.SC_UNAUTHORIZED);
      return;
    }
    String roles = request.getHeader(ROLES_HEADER);
    List<SimpleGrantedAuthority> authorities = roles == null ? List.of()
        : Arrays.stream(roles.split(","))
            .map(String::trim)
            .filter(r -> !r.isEmpty())
            .map(r -> new SimpleGrantedAuthority("ROLE_" + r))
            .toList();
    SecurityContextHolder.getContext()
        .setAuthentication(new UsernamePasswordAuthenticationToken(number, null, authorities));
    chain.doFilter(request, response);
  }
}
