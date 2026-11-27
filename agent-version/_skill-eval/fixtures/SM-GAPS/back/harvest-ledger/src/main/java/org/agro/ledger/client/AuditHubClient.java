package org.agro.ledger.client;

import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

/** Запасной путь аудита — когда брокер недоступен. */
@Component
public class AuditHubClient {

  private final RestClient rest;

  public AuditHubClient(@Value("${integration.audit-hub.url}") String url) {
    this.rest = RestClient.builder().baseUrl(url).build();
  }

  public void send(Map<String, Object> event) {
    rest.post().uri("/events").body(event).retrieve().toBodilessEntity();
  }
}
