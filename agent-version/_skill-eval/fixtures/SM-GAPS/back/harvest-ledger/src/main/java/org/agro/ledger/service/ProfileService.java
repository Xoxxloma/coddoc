package org.agro.ledger.service;

import java.util.List;
import lombok.RequiredArgsConstructor;
import org.agro.ledger.api.model.Me;
import org.agro.ledger.client.StaffProfileClient;
import org.agro.ledger.directory.RegionDirectoryDao;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class ProfileService {

  private final StaffProfileClient staff;
  private final RegionDirectoryDao directory;

  public Me me(String number) {
    Me me = new Me();
    me.setNumber(number);
    me.setFullName(staff.profile(number).fullName());
    me.setRoles(SecurityContextHolder.getContext().getAuthentication().getAuthorities().stream()
        .map(GrantedAuthority::getAuthority).map(a -> a.replaceFirst("^ROLE_", "")).toList());
    return me;
  }

  public List<RegionDirectoryDao.Unit> scope(String number) {
    List<RegionDirectoryDao.Unit> own = directory.scopeOf(number);
    return own.isEmpty() ? directory.regions() : own;
  }
}
