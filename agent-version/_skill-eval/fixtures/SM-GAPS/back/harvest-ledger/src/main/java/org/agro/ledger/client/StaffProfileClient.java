package org.agro.ledger.client;

import java.util.List;
import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestParam;

@FeignClient(name = "staff-profile", url = "${integration.staff-profile.url}")
public interface StaffProfileClient {

  record Profile(String number, String fullName, String email, String headNumber) {}

  @GetMapping("/v2/employees/{number}")
  Profile profile(@PathVariable("number") String number);

  @GetMapping("/v2/employees")
  List<Profile> byRole(@RequestParam("role") String role);
}
